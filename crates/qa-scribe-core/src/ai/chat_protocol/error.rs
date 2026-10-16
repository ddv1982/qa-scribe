#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProtocolErrorKind {
    InvalidFrame,
    UnsupportedRequest,
    ProviderFailure,
    IncompleteStream,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProtocolError {
    InvalidFrame(String),
    UnsupportedRequest(String),
    ProviderFailure(String),
    IncompleteStream(String),
}

impl ProtocolError {
    pub fn kind(&self) -> ProtocolErrorKind {
        match self {
            Self::InvalidFrame(_) => ProtocolErrorKind::InvalidFrame,
            Self::UnsupportedRequest(_) => ProtocolErrorKind::UnsupportedRequest,
            Self::ProviderFailure(_) => ProtocolErrorKind::ProviderFailure,
            Self::IncompleteStream(_) => ProtocolErrorKind::IncompleteStream,
        }
    }
}

impl std::fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let detail = match self {
            Self::InvalidFrame(detail)
            | Self::UnsupportedRequest(detail)
            | Self::ProviderFailure(detail)
            | Self::IncompleteStream(detail) => detail,
        };
        formatter.write_str(detail)
    }
}

impl std::error::Error for ProtocolError {}
