use std::{sync::mpsc, time::Instant};

use serde_json::{Value, json};

use crate::commands::providers::{ProviderDiscoveryError, ProviderDiscoveryErrorCode};

use super::{
    CLAUDE_DISCOVERY_ARGS, ClaudeCatalogResult, INITIALIZE_REQUEST_ID, MAX_FRAMES, MAX_MODELS,
    MAX_OUTPUT_BYTES, MAX_QUEUED_FRAMES, ReaderEvent, discovery_error, ensure_before_deadline,
    protocol::parse_frame, read_frames, write_initialize_frame,
};

fn parse_fixture(
    fixture: &str,
    model_limit: usize,
) -> Result<ClaudeCatalogResult, ProviderDiscoveryError> {
    for line in fixture.lines().filter(|line| !line.is_empty()) {
        if let Some(catalog) = parse_frame(line.as_bytes(), model_limit)? {
            return Ok(catalog);
        }
    }
    Err(discovery_error(
        ProviderDiscoveryErrorCode::InvalidResponse,
        "Claude model discovery ended without a catalog",
    ))
}

#[test]
fn full_success_preserves_only_supported_model_metadata() {
    let result = parse_fixture(
        include_str!("../fixtures/claude/full_success.jsonl"),
        MAX_MODELS,
    )
    .unwrap();

    assert_eq!(
        result.models,
        vec![json!({
            "id": "default",
            "label": "Default",
            "description": "Recommended selector entry",
            "reasoningEfforts": ["low", "medium", "high", "max"],
            "defaultReasoningEffort": "high",
            "supportsEffort": true,
            "supportsAdaptiveThinking": true,
            "supportsFastMode": false,
            "supportsAutoMode": true,
            "resolvedModel": "model-family-current"
        })]
    );
}

#[test]
fn partial_and_unknown_fields_are_safely_normalized() {
    let result = parse_fixture(
        include_str!("../fixtures/claude/partial_unknown_fields.jsonl"),
        MAX_MODELS,
    )
    .unwrap();

    assert_eq!(
        result.models,
        vec![
            json!({"id": "minimal"}),
            json!({
                "id": "mixed",
                "label": "Mixed",
                "reasoningEfforts": ["low", "high"],
                "supportsFastMode": false
            })
        ]
    );
}

#[test]
fn empty_catalog_is_a_successful_observation() {
    let result = parse_fixture(
        include_str!("../fixtures/claude/empty_catalog.jsonl"),
        MAX_MODELS,
    )
    .unwrap();

    assert!(result.models.is_empty());
}

#[test]
fn malformed_frame_is_rejected_without_echoing_it() {
    let error = parse_fixture(
        include_str!("../fixtures/claude/malformed_frame.jsonl"),
        MAX_MODELS,
    )
    .unwrap_err();

    assert_eq!(error.code, ProviderDiscoveryErrorCode::InvalidResponse);
    assert_eq!(
        error.message,
        "Claude model discovery returned malformed JSON"
    );
}

#[test]
fn provider_error_is_sanitized() {
    let fixture = include_str!("../fixtures/claude/error_response.jsonl");
    let error = parse_fixture(fixture, MAX_MODELS).unwrap_err();

    assert_eq!(error.code, ProviderDiscoveryErrorCode::Unavailable);
    assert_eq!(error.message, "Claude model discovery was rejected");
    assert!(!error.message.contains("private-provider-detail"));
}

#[test]
fn unauthenticated_fixture_is_classified_without_echoing_provider_details() {
    let fixture = include_str!("../fixtures/claude/unauthenticated.jsonl");
    let error = parse_fixture(fixture, MAX_MODELS).unwrap_err();

    assert_eq!(error.code, ProviderDiscoveryErrorCode::AuthRequired);
    assert_eq!(error.message, "Claude model discovery was rejected");
    assert!(!error.message.contains("synthetic-private-detail"));
}

#[test]
fn catalog_at_the_requested_limit_is_accepted() {
    let result =
        parse_fixture(include_str!("../fixtures/claude/bounded_catalog.jsonl"), 4).unwrap();

    assert_eq!(result.models.len(), 4);
    assert_eq!(result.models[3], json!({"id": "fourth"}));
}

#[test]
fn oversized_catalog_is_rejected() {
    let error =
        parse_fixture(include_str!("../fixtures/claude/bounded_catalog.jsonl"), 3).unwrap_err();

    assert_eq!(error.code, ProviderDiscoveryErrorCode::OutputLimit);
    assert_eq!(
        error.message,
        "Claude model discovery returned too many model entries"
    );
}

#[test]
fn oversized_output_stops_at_the_global_byte_limit() {
    let (sender, receiver) = mpsc::sync_channel(MAX_QUEUED_FRAMES);
    let output = vec![b'x'; MAX_OUTPUT_BYTES + 1];

    read_frames(std::io::Cursor::new(output), sender);

    assert!(matches!(
        receiver.recv().unwrap(),
        ReaderEvent::OutputLimitExceeded
    ));
    assert!(receiver.try_recv().is_err());
}

#[test]
fn excessive_frame_count_stops_within_the_global_budget() {
    let (sender, receiver) = mpsc::sync_channel(MAX_FRAMES + 1);
    let output = b"{}\n".repeat(MAX_FRAMES + 1);

    read_frames(std::io::Cursor::new(output), sender);

    assert!(matches!(
        receiver.iter().last().unwrap(),
        ReaderEvent::OutputLimitExceeded
    ));
}

#[test]
fn hostile_noise_and_account_fields_never_escape() {
    let fixture = include_str!("../fixtures/claude/hostile_noise.jsonl");
    let result = parse_fixture(fixture, MAX_MODELS).unwrap();
    let serialized = serde_json::to_string(&result.models).unwrap();

    assert_eq!(result.models, vec![json!({"id": "safe", "label": "Safe"})]);
    for forbidden in [
        "account",
        "credential",
        "privateNoise",
        "privateMetadata",
        "subscriptionType",
    ] {
        assert!(!serialized.contains(forbidden));
    }
}

#[test]
fn argv_is_an_exact_non_prompt_safety_policy() {
    assert_eq!(
        CLAUDE_DISCOVERY_ARGS,
        [
            "--output-format",
            "stream-json",
            "--verbose",
            "--input-format",
            "stream-json",
            "--setting-sources",
            "",
            "--no-session-persistence",
            "--disable-slash-commands",
            "--strict-mcp-config",
            "--mcp-config",
            r#"{"mcpServers":{}}"#,
            "--tools",
            "",
            "--settings",
            r#"{"disableAllHooks":true}"#,
        ]
    );
    assert!(
        !CLAUDE_DISCOVERY_ARGS
            .iter()
            .any(|argument| { matches!(*argument, "-p" | "--print" | "--prompt" | "--model") })
    );
}

#[test]
fn handshake_writes_exactly_one_initialize_control_request() {
    let mut output = Vec::new();

    write_initialize_frame(&mut output).unwrap();

    assert_eq!(output.iter().filter(|byte| **byte == b'\n').count(), 1);
    assert_eq!(
        serde_json::from_slice::<Value>(&output).unwrap(),
        json!({
            "type": "control_request",
            "request_id": INITIALIZE_REQUEST_ID,
            "request": {"subtype": "initialize"}
        })
    );
}

#[test]
fn expired_deadline_is_rejected_before_spawn() {
    let error = ensure_before_deadline(Instant::now()).unwrap_err();

    assert_eq!(error.code, ProviderDiscoveryErrorCode::TimedOut);
}

#[test]
fn compatibility_floor_accepts_current_and_rejects_older_claude_releases() {
    assert!(super::version_is_supported("2.1.50 (Claude Code)"));
    assert!(super::version_is_supported("2.2.0 (Claude Code)"));
    assert!(super::version_is_supported("3.0.0"));
    assert!(!super::version_is_supported("2.1.49 (Claude Code)"));
    assert!(!super::version_is_supported("2.1"));
    assert!(!super::version_is_supported("not-a-version"));
}

#[test]
#[ignore = "requires QA_SCRIBE_LIVE_CLAUDE_PATH and an authenticated Claude Code CLI"]
fn live_authenticated_catalog_contract() {
    let executable = std::env::var_os("QA_SCRIBE_LIVE_CLAUDE_PATH")
        .map(std::path::PathBuf::from)
        .expect("set QA_SCRIBE_LIVE_CLAUDE_PATH to the exact Claude executable");
    let started = Instant::now();
    let result = super::discover(&executable, started + std::time::Duration::from_secs(12))
        .expect("authenticated Claude catalog discovery must succeed");

    eprintln!(
        "live Claude catalog: {} models in {} ms",
        result.models.len(),
        started.elapsed().as_millis()
    );
    assert!(!result.models.is_empty());
    assert!(started.elapsed() < std::time::Duration::from_secs(12));
}
