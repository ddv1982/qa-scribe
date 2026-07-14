use std::{io::Cursor, time::Instant};

use serde_json::{Value, json};

use super::{
    CONNECT_REQUEST_ID, DISCOVERY_METHODS, MAX_FRAMES, MAX_MODELS, MAX_TRANSACTION_BYTES,
    ProviderDiscoveryErrorCode, ensure_before_deadline,
    framing::{FrameBudget, FrameFailure, read_frame, send_request},
    normalization::parse_models,
    protocol::{RpcStage, classify_rpc_error, parse_connect, require_authenticated},
};

fn fixture_value(fixture: &str) -> Value {
    serde_json::from_str(fixture).unwrap()
}

#[test]
fn success_preserves_only_whitelisted_model_metadata() {
    let models = parse_models(
        fixture_value(include_str!("../fixtures/copilot/success.json")),
        MAX_MODELS,
    )
    .unwrap();

    assert_eq!(
        models,
        vec![json!({
            "id": "model-family-current",
            "label": "Current Model",
            "description": "General purpose model",
            "reasoningEfforts": ["low", "medium", "high"],
            "defaultReasoningEffort": "medium",
            "vision": true,
            "reasoning": true,
            "adaptiveThinking": true,
            "contextWindowTokens": 128000,
            "maxOutputTokens": 32000,
            "policyState": "enabled"
        })]
    );
}

#[test]
fn policy_disabled_and_unconfigured_are_preserved() {
    let models = parse_models(
        fixture_value(include_str!("../fixtures/copilot/policy_states.json")),
        MAX_MODELS,
    )
    .unwrap();

    assert_eq!(models[0]["policyState"], "disabled");
    assert_eq!(models[1]["policyState"], "unconfigured");
}

#[test]
fn missing_optional_and_unknown_fields_are_safely_discarded() {
    let models = parse_models(
        fixture_value(include_str!(
            "../fixtures/copilot/missing_optional_unknown.json"
        )),
        MAX_MODELS,
    )
    .unwrap();

    assert_eq!(models, vec![json!({"id": "minimal", "label": "Minimal"})]);
}

#[test]
fn signed_out_response_is_a_sanitized_auth_error() {
    let error = require_authenticated(fixture_value(include_str!(
        "../fixtures/copilot/signed_out.json"
    )))
    .unwrap_err();

    assert_eq!(error.code, ProviderDiscoveryErrorCode::AuthRequired);
    assert_eq!(
        error.message,
        "GitHub Copilot authentication is required for model discovery."
    );
}

#[test]
fn protocol_mismatch_is_version_gated() {
    for response in [
        fixture_value(include_str!("../fixtures/copilot/protocol_mismatch.json")),
        json!({"ok": true, "protocolVersion": 4, "version": "newer-than-supported"}),
    ] {
        let error = parse_connect(response).unwrap_err();
        assert_eq!(error.code, ProviderDiscoveryErrorCode::ProtocolIncompatible);
    }
}

#[test]
fn malformed_and_oversized_frames_are_rejected_before_use() {
    for (fixture, expected) in [
        (
            include_str!("../fixtures/copilot/malformed_frame.txt"),
            FrameFailure::Malformed,
        ),
        (
            include_str!("../fixtures/copilot/oversized_frame.txt"),
            FrameFailure::OutputLimit,
        ),
    ] {
        let mut reader = Cursor::new(fixture.as_bytes());
        let error = read_frame(&mut reader, &mut FrameBudget::default()).unwrap_err();
        assert_eq!(error, expected);
    }
}

#[test]
fn empty_catalog_is_a_successful_observation() {
    let models = parse_models(
        fixture_value(include_str!("../fixtures/copilot/empty_catalog.json")),
        MAX_MODELS,
    )
    .unwrap();
    assert!(models.is_empty());
}

#[test]
fn duplicate_models_keep_the_first_authoritative_entry() {
    let models = parse_models(
        fixture_value(include_str!("../fixtures/copilot/duplicate_catalog.json")),
        MAX_MODELS,
    )
    .unwrap();

    assert_eq!(models, vec![json!({"id": "same", "label": "First"})]);
}

#[test]
fn catalog_size_is_rejected_instead_of_truncated() {
    let error = parse_models(
        fixture_value(include_str!("../fixtures/copilot/large_catalog.json")),
        2,
    )
    .unwrap_err();

    assert_eq!(error.code, ProviderDiscoveryErrorCode::OutputLimit);
}

#[test]
fn provider_status_errors_are_classified_without_echoing_payloads() {
    for (fixture, code) in [
        (
            include_str!("../fixtures/copilot/error_401.json"),
            ProviderDiscoveryErrorCode::AuthRequired,
        ),
        (
            include_str!("../fixtures/copilot/error_403.json"),
            ProviderDiscoveryErrorCode::PolicyDenied,
        ),
        (
            include_str!("../fixtures/copilot/error_421.json"),
            ProviderDiscoveryErrorCode::Network,
        ),
        (
            include_str!("../fixtures/copilot/error_429.json"),
            ProviderDiscoveryErrorCode::RateLimited,
        ),
        (
            include_str!("../fixtures/copilot/error_503.json"),
            ProviderDiscoveryErrorCode::Network,
        ),
    ] {
        let error = classify_rpc_error(&fixture_value(fixture), RpcStage::Models);
        assert_eq!(error.code, code);
        assert!(!error.message.contains("request rejected"));
    }
}

#[test]
fn request_frame_is_content_length_json_rpc_with_empty_params() {
    let mut bytes = Vec::new();
    send_request(&mut bytes, CONNECT_REQUEST_ID, DISCOVERY_METHODS[0]).unwrap();
    let mut reader = Cursor::new(bytes);
    let request = read_frame(&mut reader, &mut FrameBudget::default())
        .unwrap()
        .unwrap();

    assert_eq!(
        request,
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "connect",
            "params": {}
        })
    );
}

#[test]
fn transaction_and_frame_count_limits_are_enforced() {
    let body = br#"{}"#;
    let frame = format!("Content-Length: {}\r\n\r\n{{}}", body.len());

    let mut transaction_budget = FrameBudget {
        frames: 0,
        bytes: MAX_TRANSACTION_BYTES - 1,
    };
    assert_eq!(
        read_frame(&mut Cursor::new(frame.as_bytes()), &mut transaction_budget).unwrap_err(),
        FrameFailure::OutputLimit
    );

    let mut frame_budget = FrameBudget {
        frames: MAX_FRAMES,
        bytes: 0,
    };
    assert!(
        read_frame(&mut Cursor::new(Vec::<u8>::new()), &mut frame_budget)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        read_frame(&mut Cursor::new(frame.as_bytes()), &mut frame_budget).unwrap_err(),
        FrameFailure::FrameLimit
    );
}

#[test]
fn fixtures_do_not_contain_sensitive_or_prompt_bearing_fields() {
    let fixtures = [
        include_str!("../fixtures/copilot/success.json"),
        include_str!("../fixtures/copilot/policy_states.json"),
        include_str!("../fixtures/copilot/missing_optional_unknown.json"),
        include_str!("../fixtures/copilot/signed_out.json"),
        include_str!("../fixtures/copilot/protocol_mismatch.json"),
        include_str!("../fixtures/copilot/empty_catalog.json"),
        include_str!("../fixtures/copilot/duplicate_catalog.json"),
        include_str!("../fixtures/copilot/large_catalog.json"),
        include_str!("../fixtures/copilot/error_401.json"),
        include_str!("../fixtures/copilot/error_403.json"),
        include_str!("../fixtures/copilot/error_421.json"),
        include_str!("../fixtures/copilot/error_429.json"),
        include_str!("../fixtures/copilot/error_503.json"),
    ];
    for fixture in fixtures {
        for forbidden in [
            "\"token\"",
            "authToken",
            "accessToken",
            "\"login\"",
            "\"host\"",
            "\"email\"",
            "\"prompt\"",
            "\"repository\"",
            "\"terms\"",
            "\"billing\"",
        ] {
            assert!(
                !fixture.contains(forbidden),
                "fixture contained {forbidden}"
            );
        }
    }
}

#[test]
fn request_surface_is_exactly_the_read_only_catalog_sequence() {
    assert_eq!(
        DISCOVERY_METHODS,
        [
            "connect",
            "status.get",
            "auth.getStatus",
            "models.list",
            "runtime.shutdown"
        ]
    );
    assert!(
        !DISCOVERY_METHODS
            .iter()
            .any(|method| method.starts_with("session.") || method.contains("prompt"))
    );
}

#[test]
fn expired_deadline_is_rejected_before_spawn() {
    let error = ensure_before_deadline(Instant::now()).unwrap_err();
    assert_eq!(error.code, ProviderDiscoveryErrorCode::TimedOut);
}

#[test]
#[ignore = "requires QA_SCRIBE_LIVE_COPILOT_PATH and an authenticated GitHub Copilot CLI"]
fn live_authenticated_catalog_contract() {
    let executable = std::env::var_os("QA_SCRIBE_LIVE_COPILOT_PATH")
        .map(std::path::PathBuf::from)
        .expect("set QA_SCRIBE_LIVE_COPILOT_PATH to the exact Copilot executable");
    let started = Instant::now();
    let result = super::discover(&executable, started + std::time::Duration::from_secs(12))
        .expect("authenticated Copilot catalog discovery must succeed");

    eprintln!(
        "live Copilot catalog: {} models in {} ms",
        result.models.len(),
        started.elapsed().as_millis()
    );
    assert!(!result.models.is_empty());
    assert!(started.elapsed() < std::time::Duration::from_secs(12));
}
