use thiserror::Error;

pub type Result<T> = std::result::Result<T, QaScribeError>;

#[derive(Debug, Error)]
pub enum QaScribeError {
    #[error("validation failed: {0}")]
    Validation(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid stored value for {field}: {value}")]
    InvalidStoredValue { field: &'static str, value: String },
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub fn validation(message: impl Into<String>) -> QaScribeError {
    QaScribeError::Validation(message.into())
}
