use std::collections::HashSet;

use chrono::{DateTime, SecondsFormat, TimeDelta, Utc};
use serde::{Deserialize, Serialize};

use crate::{Result, error::validation};

pub const LOG_RESULT_MAX_BYTES: usize = 256 * 1024;
pub const LOG_RESULT_MAX_ROWS: usize = 500;
const MAX_SOURCES: usize = 20;
const MAX_KQL_BYTES: usize = 16 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationLogSource {
    pub label: String,
    pub resource_id: String,
}

impl ApplicationLogSource {
    pub fn validated(mut self) -> Result<Self> {
        self.label = self.label.trim().to_owned();
        self.resource_id = self.resource_id.trim().to_owned();
        if self.label.is_empty()
            || self.label.chars().count() > 80
            || self.label.chars().any(char::is_control)
        {
            return Err(validation("Use a source label of 1 to 80 characters."));
        }
        if application_insights_id_parts(&self.resource_id).is_none() {
            return Err(validation(
                "Enter the full Application Insights resource ID.",
            ));
        }
        Ok(self)
    }
}

pub(crate) fn validate_application_log_sources(
    sources: Vec<ApplicationLogSource>,
) -> Result<Vec<ApplicationLogSource>> {
    if sources.len() > MAX_SOURCES {
        return Err(validation("Configure at most 20 application log sources."));
    }
    let sources = sources
        .into_iter()
        .map(ApplicationLogSource::validated)
        .collect::<Result<Vec<_>>>()?;
    let mut ids = HashSet::new();
    let mut labels = HashSet::new();
    for source in &sources {
        if !ids.insert(source.resource_id.to_ascii_lowercase())
            || !labels.insert(source.label.to_lowercase())
        {
            return Err(validation(
                "Each application log source must have a unique resource ID and label.",
            ));
        }
    }
    Ok(sources)
}

pub fn application_insights_id_parts(value: &str) -> Option<(uuid::Uuid, &str, &str)> {
    let parts: Vec<_> = value.split('/').collect();
    let [
        "",
        subscriptions,
        subscription,
        groups,
        group,
        providers,
        provider,
        components,
        name,
    ] = parts.as_slice()
    else {
        return None;
    };
    let is_name = |part: &str| {
        !part.is_empty()
            && part.len() <= 260
            && !matches!(part, "." | "..")
            && part.bytes().all(|ch| {
                ch.is_ascii_alphanumeric() || matches!(ch, b'_' | b'-' | b'.' | b'(' | b')')
            })
    };
    if subscriptions.eq_ignore_ascii_case("subscriptions")
        && subscription.len() == 36
        && groups.eq_ignore_ascii_case("resourceGroups")
        && is_name(group)
        && providers.eq_ignore_ascii_case("providers")
        && provider.eq_ignore_ascii_case("microsoft.insights")
        && components.eq_ignore_ascii_case("components")
        && is_name(name)
    {
        Some((uuid::Uuid::try_parse(subscription).ok()?, group, name))
    } else {
        None
    }
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationLogQuery {
    pub target_id: String,
    pub kql: String,
    pub start: String,
    pub end: String,
}

pub struct ValidatedApplicationLogQuery {
    pub target: ApplicationLogSource,
    pub kql: String,
    pub start: String,
    pub end: String,
}

impl ApplicationLogQuery {
    pub fn validate(
        self,
        configured: &[ApplicationLogSource],
    ) -> Result<ValidatedApplicationLogQuery> {
        let target = configured
            .iter()
            .find(|source| source.resource_id.eq_ignore_ascii_case(&self.target_id))
            .filter(|source| application_insights_id_parts(&source.resource_id).is_some())
            .cloned()
            .ok_or_else(|| validation("Select a configured Application Insights query target."))?;
        // Knack expands the @file argument before parsing CLI options.
        let kql = self.kql.trim();
        if kql.is_empty()
            || self.kql.len() > MAX_KQL_BYTES
            || kql.starts_with(['-', '@'])
            || kql.contains('\0')
        {
            return Err(validation("Enter a KQL query of at most 16 KiB."));
        }
        let parse = |value: &str| {
            DateTime::parse_from_rfc3339(value)
                .map(|time| time.with_timezone(&Utc))
                .map_err(|_| validation("Enter a valid start and end time."))
        };
        let start = parse(&self.start)?;
        let end = parse(&self.end)?;
        if end <= start || end - start > TimeDelta::days(7) {
            return Err(validation(
                "Choose a time window greater than zero and at most 7 days.",
            ));
        }
        Ok(ValidatedApplicationLogQuery {
            target,
            kql: self.kql,
            start: start.to_rfc3339_opts(SecondsFormat::AutoSi, true),
            end: end.to_rfc3339_opts(SecondsFormat::AutoSi, true),
        })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LogEvidenceSummary {
    pub id: String,
    pub case_id: String,
    pub source_labels: Vec<String>,
    pub start: String,
    pub end: String,
    pub executed_at: String,
    pub row_count: u32,
    pub truncated: bool,
    pub portal_url: String,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LogEvidenceDetails {
    pub kql: String,
    pub result_json: String,
}

pub struct QueriedApplicationLogs {
    pub result_json: String,
    pub row_count: u32,
    pub truncated: bool,
    pub portal_url: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    const TARGET: &str = "/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/qa/providers/Microsoft.Insights/components/checkout";

    fn target() -> ApplicationLogSource {
        ApplicationLogSource {
            label: "Checkout".into(),
            resource_id: TARGET.into(),
        }
    }

    fn query() -> ApplicationLogQuery {
        ApplicationLogQuery {
            target_id: TARGET.to_ascii_lowercase(),
            kql: "  traces | where timestamp >= ago(1h)\n".into(),
            start: "2026-11-24T10:00:00.123+01:00".into(),
            end: "2026-11-24T10:15:00.456+01:00".into(),
        }
    }

    #[test]
    fn configured_target_preserves_kql_and_normalizes_exact_bounds() {
        let input = query();
        let validated = input.clone().validate(&[target()]).unwrap();
        assert_eq!(validated.target, target());
        assert_eq!(validated.kql, input.kql);
        assert_eq!(validated.start, "2026-11-24T09:00:00.123Z");
        assert_eq!(validated.end, "2026-11-24T09:15:00.456Z");
    }

    #[test]
    fn rejects_unconfigured_or_option_like_targets_and_ambiguous_settings() {
        assert!(query().validate(&[]).is_err());
        for bad in [
            "-o",
            "@/tmp/argument",
            "/malformed",
            &format!("{TARGET}?api-version=1"),
        ] {
            let source = ApplicationLogSource {
                resource_id: bad.into(),
                ..target()
            };
            assert!(source.clone().validated().is_err());
            let input = ApplicationLogQuery {
                target_id: bad.into(),
                ..query()
            };
            assert!(input.validate(&[source]).is_err());
        }
        assert!(
            validate_application_log_sources(vec![
                target(),
                ApplicationLogSource {
                    label: "Different label".into(),
                    resource_id: TARGET.to_ascii_lowercase(),
                }
            ])
            .is_err()
        );
        assert!(
            validate_application_log_sources(vec![
                target(),
                ApplicationLogSource {
                    label: " checkout ".into(),
                    resource_id: format!("{TARGET}-2"),
                }
            ])
            .is_err()
        );
    }

    #[test]
    fn bounds_kql_bytes_and_validates_the_utc_interval() {
        for kql in [
            " ".into(),
            " -h".into(),
            "@/tmp/file".into(),
            "print '\0'".into(),
            "é".repeat(MAX_KQL_BYTES / 2 + 1),
        ] {
            assert!(
                ApplicationLogQuery { kql, ..query() }
                    .validate(&[target()])
                    .is_err()
            );
        }
        for end in [
            "2026-12-02T09:00:00Z",
            "2026-11-24T09:00:00.123Z",
            "2026-11-24T09:15:00",
        ] {
            assert!(
                ApplicationLogQuery {
                    end: end.into(),
                    ..query()
                }
                .validate(&[target()])
                .is_err()
            );
        }
    }
}
