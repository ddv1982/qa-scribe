use std::{
    sync::mpsc,
    time::{Duration, Instant},
};

use serde_json::json;

use super::{JsonLineEvent, ResponseRouter, collect_model_pages, response_result};
use crate::commands::providers::ProviderDiscoveryErrorCode;

#[test]
fn response_router_preserves_out_of_order_results() {
    let (sender, receiver) = mpsc::channel();
    sender
        .send(JsonLineEvent::Value(
            json!({"id": 2, "result": {"value": "models"}}),
        ))
        .unwrap();
    sender
        .send(JsonLineEvent::Value(
            json!({"id": 1, "result": {"value": "config"}}),
        ))
        .unwrap();
    let mut router = ResponseRouter::new(&receiver);

    assert_eq!(
        router
            .receive(1, Instant::now() + Duration::from_millis(50))
            .unwrap(),
        json!({"value": "config"})
    );
    assert_eq!(
        router
            .receive(2, Instant::now() + Duration::from_millis(50))
            .unwrap(),
        json!({"value": "models"})
    );
}

#[test]
fn response_router_reports_timeout_explicitly() {
    let (_sender, receiver) = mpsc::channel();
    let error = ResponseRouter::new(&receiver)
        .receive(7, Instant::now() + Duration::from_millis(1))
        .unwrap_err();

    assert_eq!(error.code, ProviderDiscoveryErrorCode::TimedOut);
}

#[test]
fn unsupported_app_server_method_is_not_provider_managed() {
    let error = response_result(json!({
        "id": 1,
        "error": {"code": -32601, "message": "Method not found"}
    }))
    .unwrap_err();

    assert_eq!(error.code, ProviderDiscoveryErrorCode::Unsupported);
    assert!(!error.message.contains("Method not found"));
}

#[test]
fn app_server_error_payloads_are_not_copied_into_discovery_errors() {
    let error = response_result(json!({
        "id": 1,
        "error": {
            "code": -32000,
            "message": "token ghp_private at /Users/private/repository"
        }
    }))
    .unwrap_err();

    assert_eq!(error.code, ProviderDiscoveryErrorCode::InvalidResponse);
    assert_eq!(error.message, "Codex app-server returned an error response");
}

#[test]
fn paginated_model_catalog_collects_every_page_in_order() {
    let mut requested = Vec::new();
    let models = collect_model_pages(
        json!({"data": [{"model": "first"}], "nextCursor": "page-2"}),
        |request_id, cursor| {
            requested.push((request_id, cursor.to_string()));
            Ok(json!({"data": [{"model": "second"}], "nextCursor": null}))
        },
    )
    .unwrap();

    assert_eq!(requested, vec![(3, "page-2".to_string())]);
    assert_eq!(
        models,
        vec![json!({"model": "first"}), json!({"model": "second"})]
    );
}

#[test]
fn invalid_catalog_schema_is_reported() {
    let error =
        collect_model_pages(json!({"models": []}), |_id, _cursor| unreachable!()).unwrap_err();

    assert_eq!(error.code, ProviderDiscoveryErrorCode::InvalidResponse);
}
