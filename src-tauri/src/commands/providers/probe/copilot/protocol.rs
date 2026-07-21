use std::{collections::HashMap, sync::mpsc, time::Instant};

use serde_json::{Map, Value};

use crate::commands::providers::probe::cancel::{
    CANCELLATION_POLL_INTERVAL, DiscoveryCancellation,
};
use crate::commands::providers::{ProviderDiscoveryError, ProviderDiscoveryErrorCode};

use super::{
    COPILOT_PROTOCOL_VERSION, discovery_error,
    framing::{ReaderEvent, frame_error},
    invalid_response,
    normalization::optional_nonempty_string,
};

#[derive(Clone, Copy)]
pub(super) enum RpcStage {
    Connect,
    Status,
    Auth,
    Models,
}

pub(super) struct ResponseRouter<'a> {
    receiver: &'a mpsc::Receiver<ReaderEvent>,
    pending: HashMap<u64, Value>,
    cancellation: DiscoveryCancellation,
}

impl<'a> ResponseRouter<'a> {
    pub(super) fn new_with_cancellation(
        receiver: &'a mpsc::Receiver<ReaderEvent>,
        cancellation: DiscoveryCancellation,
    ) -> Self {
        Self {
            receiver,
            pending: HashMap::new(),
            cancellation,
        }
    }

    pub(super) fn receive(
        &mut self,
        id: u64,
        deadline: Instant,
        stage: RpcStage,
    ) -> Result<Value, ProviderDiscoveryError> {
        if let Some(value) = self.pending.remove(&id) {
            return response_result(value, stage);
        }

        loop {
            self.cancellation.check("GitHub Copilot")?;
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .ok_or_else(timed_out)?;
            let event = match self
                .receiver
                .recv_timeout(remaining.min(CANCELLATION_POLL_INTERVAL))
            {
                Ok(event) => event,
                Err(mpsc::RecvTimeoutError::Timeout) if remaining > CANCELLATION_POLL_INTERVAL => {
                    continue;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => return Err(timed_out()),
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(missing_response());
                }
            };

            match event {
                ReaderEvent::Frame(value) => {
                    let Some(response_id) = response_id(&value)? else {
                        // Ignore server notifications. No notification payload
                        // is ever retained or returned.
                        continue;
                    };
                    if response_id == id {
                        return response_result(value, stage);
                    }
                    self.pending.insert(response_id, value);
                }
                ReaderEvent::End => return Err(missing_response()),
                ReaderEvent::Failed(failure) => return Err(frame_error(failure)),
            }
        }
    }
}

fn timed_out() -> ProviderDiscoveryError {
    discovery_error(
        ProviderDiscoveryErrorCode::TimedOut,
        "GitHub Copilot model discovery timed out.",
    )
}

fn missing_response() -> ProviderDiscoveryError {
    discovery_error(
        ProviderDiscoveryErrorCode::InvalidResponse,
        "GitHub Copilot model discovery ended without a response.",
    )
}

fn response_id(value: &Value) -> Result<Option<u64>, ProviderDiscoveryError> {
    let response = value.as_object().ok_or_else(invalid_response)?;
    response
        .get("id")
        .map(|id| id.as_u64().ok_or_else(invalid_response))
        .transpose()
}

fn response_result(value: Value, stage: RpcStage) -> Result<Value, ProviderDiscoveryError> {
    let response = value.as_object().ok_or_else(invalid_response)?;
    if response.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Err(invalid_response());
    }
    if let Some(error) = response.get("error") {
        return Err(classify_rpc_error(error, stage));
    }
    response.get("result").cloned().ok_or_else(invalid_response)
}

pub(super) fn parse_connect(result: Value) -> Result<Option<String>, ProviderDiscoveryError> {
    let result = result.as_object().ok_or_else(invalid_response)?;
    if result.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(discovery_error(
            ProviderDiscoveryErrorCode::HandshakeFailed,
            "GitHub Copilot rejected the discovery handshake.",
        ));
    }
    require_protocol_version(result)?;
    Ok(optional_nonempty_string(result.get("version")))
}

pub(super) fn parse_status(result: Value) -> Result<Option<String>, ProviderDiscoveryError> {
    let result = result.as_object().ok_or_else(invalid_response)?;
    require_protocol_version(result)?;
    Ok(optional_nonempty_string(result.get("version")))
}

fn require_protocol_version(result: &Map<String, Value>) -> Result<(), ProviderDiscoveryError> {
    if result.get("protocolVersion").and_then(Value::as_u64) == Some(COPILOT_PROTOCOL_VERSION) {
        Ok(())
    } else {
        Err(discovery_error(
            ProviderDiscoveryErrorCode::ProtocolIncompatible,
            "GitHub Copilot CLI protocol 3 is required for model discovery.",
        ))
    }
}

pub(super) fn require_authenticated(result: Value) -> Result<(), ProviderDiscoveryError> {
    match result
        .as_object()
        .and_then(|result| result.get("isAuthenticated"))
        .and_then(Value::as_bool)
    {
        Some(true) => Ok(()),
        Some(false) => Err(discovery_error(
            ProviderDiscoveryErrorCode::AuthRequired,
            "GitHub Copilot authentication is required for model discovery.",
        )),
        None => Err(invalid_response()),
    }
}

pub(super) fn classify_rpc_error(error: &Value, stage: RpcStage) -> ProviderDiscoveryError {
    let rpc_code = error.get("code").and_then(Value::as_i64);
    let status = http_status(error).or_else(|| rpc_code.filter(|code| (400..=599).contains(code)));
    match status {
        Some(401) => discovery_error(
            ProviderDiscoveryErrorCode::AuthRequired,
            "GitHub Copilot authentication is required for model discovery.",
        ),
        Some(403) => discovery_error(
            ProviderDiscoveryErrorCode::PolicyDenied,
            "GitHub Copilot model discovery is not permitted for this account.",
        ),
        Some(421) => discovery_error(
            ProviderDiscoveryErrorCode::Network,
            "GitHub Copilot account routing could not be resolved.",
        ),
        Some(429) => discovery_error(
            ProviderDiscoveryErrorCode::RateLimited,
            "GitHub Copilot model discovery is temporarily rate limited.",
        ),
        Some(502..=504) => discovery_error(
            ProviderDiscoveryErrorCode::Network,
            "GitHub Copilot model discovery could not reach the provider service.",
        ),
        _ if rpc_code == Some(-32601) => discovery_error(
            ProviderDiscoveryErrorCode::ProtocolIncompatible,
            "GitHub Copilot CLI protocol 3 model discovery is unavailable.",
        ),
        _ if matches!(stage, RpcStage::Connect | RpcStage::Status) => discovery_error(
            ProviderDiscoveryErrorCode::HandshakeFailed,
            "GitHub Copilot model discovery handshake failed.",
        ),
        _ => discovery_error(
            ProviderDiscoveryErrorCode::Unavailable,
            "GitHub Copilot model discovery request failed.",
        ),
    }
}

fn http_status(value: &Value) -> Option<i64> {
    let object = value.as_object()?;
    for key in ["status", "statusCode", "httpStatus", "httpStatusCode"] {
        if let Some(status) = object.get(key).and_then(Value::as_i64) {
            return Some(status);
        }
    }
    object.get("data").and_then(http_status)
}
