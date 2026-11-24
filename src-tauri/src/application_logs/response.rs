use std::{collections::BTreeMap, io::Write};

use base64::{Engine, engine::general_purpose::STANDARD};
use flate2::{Compression, write::GzEncoder};
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use qa_scribe_core::domain::{
    LOG_RESULT_MAX_BYTES, LOG_RESULT_MAX_ROWS, QueriedApplicationLogs, ValidatedApplicationLogQuery,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{ApplicationLogAccess, LogQueryError};

pub(super) fn classify_error(stderr: &str) -> ApplicationLogAccess {
    let message = stderr.to_ascii_lowercase();
    if message.contains("app-insights")
        && (message.contains("not recognized")
            || message.contains("misspelled")
            || message.contains("not in the"))
    {
        ApplicationLogAccess::ExtensionMissing
    } else if message.contains("az login") || message.contains("interaction_required") {
        ApplicationLogAccess::SignedOut
    } else if [
        "authorizationfailed",
        "insufficientaccesserror",
        "accessdenied",
        "forbidden",
        "status code: 403",
    ]
    .iter()
    .any(|part| message.contains(part))
    {
        ApplicationLogAccess::AccessDenied
    } else {
        ApplicationLogAccess::Failed
    }
}

pub(super) fn indicates_partial_response(stderr: &str) -> bool {
    let stderr = stderr.to_ascii_lowercase();
    [
        "partialerror",
        "partialqueryfailure",
        "partial query",
        "partial result",
    ]
    .iter()
    .any(|marker| stderr.contains(marker))
        || stderr
            .lines()
            .any(|line| line.trim_start().starts_with("error:"))
}

#[derive(Deserialize, Serialize)]
struct AzureResult {
    tables: Vec<AzureTable>,
    #[serde(flatten, skip_serializing)]
    response_fields: BTreeMap<String, Value>,
}

#[derive(Deserialize, Serialize)]
struct AzureTable {
    name: String,
    columns: Vec<AzureColumn>,
    rows: Vec<Vec<Value>>,
}

#[derive(Deserialize, Serialize)]
struct AzureColumn {
    name: String,
    #[serde(rename = "type")]
    data_type: String,
}

pub(super) fn capture(
    query: &ValidatedApplicationLogQuery,
    bytes: &[u8],
) -> Result<QueriedApplicationLogs, LogQueryError> {
    let mut result: AzureResult =
        serde_json::from_slice(bytes).map_err(|_| LogQueryError::InvalidResponse)?;
    if result.response_fields.iter().any(|(key, value)| {
        (key.eq_ignore_ascii_case("error") || key.eq_ignore_ascii_case("partialError"))
            && !value.is_null()
    }) {
        return Err(LogQueryError::InvalidResponse);
    }
    if result.tables.is_empty()
        || result.tables.iter().any(|table| {
            table.name.is_empty()
                || table.columns.is_empty()
                || table
                    .columns
                    .iter()
                    .any(|column| column.name.is_empty() || column.data_type.is_empty())
                || table
                    .rows
                    .iter()
                    .any(|row| row.len() != table.columns.len())
        })
    {
        return Err(LogQueryError::InvalidResponse);
    }
    let table_rows: Vec<_> = result
        .tables
        .iter_mut()
        .map(|table| std::mem::take(&mut table.rows))
        .collect();
    let returned_rows = table_rows.iter().map(Vec::len).sum::<usize>();
    let encode = |data: &AzureResult| {
        serde_json::to_string(data).map_err(|_| LogQueryError::InvalidResponse)
    };
    let mut remaining = LOG_RESULT_MAX_BYTES
        .checked_sub(encode(&result)?.len())
        .ok_or(LogQueryError::TooMuchOutput)?;
    let mut row_count = 0;
    'tables: for (table, rows) in result.tables.iter_mut().zip(table_rows) {
        for row in rows {
            let bytes = serde_json::to_vec(&row)
                .map_err(|_| LogQueryError::InvalidResponse)?
                .len()
                + usize::from(!table.rows.is_empty());
            if row_count == LOG_RESULT_MAX_ROWS || bytes > remaining {
                break 'tables;
            }
            remaining -= bytes;
            row_count += 1;
            table.rows.push(row);
        }
    }
    if row_count == 0 && returned_rows != 0 {
        return Err(LogQueryError::TooMuchOutput);
    }
    let result_json = encode(&result)?;
    Ok(QueriedApplicationLogs {
        result_json,
        row_count: row_count as u32,
        truncated: row_count < returned_rows,
        portal_url: portal_url(query)?,
    })
}

fn portal_url(query: &ValidatedApplicationLogQuery) -> Result<String, LogQueryError> {
    let mut gzip = GzEncoder::new(Vec::new(), Compression::default());
    gzip.write_all(query.kql.as_bytes())
        .map_err(|_| LogQueryError::InvalidResponse)?;
    let encoded = STANDARD.encode(gzip.finish().map_err(|_| LogQueryError::InvalidResponse)?);
    let primary = utf8_percent_encode(&query.target.resource_id, NON_ALPHANUMERIC);
    let encoded = utf8_percent_encode(&encoded, NON_ALPHANUMERIC);
    Ok(format!(
        "https://portal.azure.com/#view/Microsoft_OperationsManagementSuite_Workspace/Logs.ReactView/resourceId/{primary}/source/LogsBlade.AnalyticsShareLinkToQuery/q/{encoded}"
    ))
}
