use std::{collections::HashSet, sync::atomic::AtomicBool};

use qa_scribe_core::domain::application_insights_id_parts;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    ApplicationLogAccess, LogQueryError, NeutralProviderCwd, QUERY_TIMEOUT, resolve_az, run_cli,
};

const ACCOUNT_ARGS: [&str; 6] = [
    "account",
    "list",
    "--query",
    "[?state=='Enabled'].{id:id,name:name}",
    "-o",
    "json",
];

fn resource_args(subscription: &str) -> [&str; 10] {
    [
        "resource",
        "list",
        "--resource-type",
        "Microsoft.Insights/components",
        "--subscription",
        subscription,
        "--query",
        "[].id",
        "-o",
        "json",
    ]
}

#[derive(Serialize, specta::Type)]
pub struct AzureSubscription {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationInsightsComponent {
    pub name: String,
    pub resource_group: String,
    pub resource_id: String,
}

#[derive(Deserialize)]
struct Account {
    id: String,
    name: String,
}

pub fn subscription_id(value: &str) -> Option<Uuid> {
    let id = Uuid::try_parse(value).ok()?;
    id.hyphenated()
        .to_string()
        .eq_ignore_ascii_case(value)
        .then_some(id)
}

pub fn subscriptions(cancelled: &AtomicBool) -> Result<Vec<AzureSubscription>, LogQueryError> {
    let bytes = metadata(ACCOUNT_ARGS, cancelled)?;
    let accounts: Vec<Account> = parse(&bytes)?;
    let mut seen = HashSet::new();
    Ok(accounts
        .into_iter()
        .filter_map(|account| {
            let id = subscription_id(&account.id)?;
            let name = account.name.trim();
            if name.is_empty() || name.chars().any(char::is_control) || !seen.insert(id) {
                return None;
            }
            Some(AzureSubscription {
                id: id.to_string(),
                name: name.to_owned(),
            })
        })
        .collect())
}

pub fn components(
    subscription: Uuid,
    cancelled: &AtomicBool,
) -> Result<Vec<ApplicationInsightsComponent>, LogQueryError> {
    let bytes = metadata(resource_args(&subscription.to_string()), cancelled)?;
    parse_components(&bytes, subscription)
}

fn parse_components(
    bytes: &[u8],
    subscription: Uuid,
) -> Result<Vec<ApplicationInsightsComponent>, LogQueryError> {
    let ids: Vec<String> = parse(bytes)?;
    let mut seen = HashSet::new();
    Ok(ids
        .into_iter()
        .filter_map(|resource_id| {
            let (owner, resource_group, name) = application_insights_id_parts(&resource_id)?;
            if owner != subscription || !seen.insert(resource_id.to_lowercase()) {
                return None;
            }
            Some(ApplicationInsightsComponent {
                name: name.to_owned(),
                resource_group: resource_group.to_owned(),
                resource_id,
            })
        })
        .collect())
}

fn metadata(
    args: impl IntoIterator<Item = impl AsRef<std::ffi::OsStr>>,
    cancelled: &AtomicBool,
) -> Result<Vec<u8>, LogQueryError> {
    let az = resolve_az()?;
    let cwd = NeutralProviderCwd::new()
        .map_err(|_| LogQueryError::Access(ApplicationLogAccess::Failed))?;
    run_cli(
        &az,
        cwd.path(),
        args,
        &|| cancelled.load(std::sync::atomic::Ordering::Acquire),
        QUERY_TIMEOUT,
    )
}

fn parse<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<T, LogQueryError> {
    serde_json::from_slice(bytes).map_err(|_| LogQueryError::InvalidResponse)
}

pub fn error_message(error: LogQueryError) -> &'static str {
    use ApplicationLogAccess::{AccessDenied, CliMissing, SignedOut, TimedOut, Unsupported};
    match error {
        LogQueryError::Access(CliMissing | SignedOut | Unsupported) => error.message(),
        LogQueryError::Access(AccessDenied) => {
            "Azure denied access to discovery metadata for this subscription."
        }
        LogQueryError::Access(TimedOut) => "Azure discovery timed out.",
        LogQueryError::Access(_) => {
            "Azure CLI could not list discovery metadata. Check your Azure CLI sign-in."
        }
        LogQueryError::Cancelled => "Azure discovery was cancelled.",
        LogQueryError::TooMuchOutput => "Azure returned too many discovery results.",
        LogQueryError::InvalidResponse => {
            "Azure CLI returned incomplete or invalid discovery metadata."
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_requires_a_hyphenated_subscription_uuid() {
        let id = "11111111-1111-4111-8111-11111111ABCD";
        assert_eq!(
            subscription_id(id).unwrap().to_string(),
            id.to_ascii_lowercase()
        );
        for invalid in [
            "--debug",
            "1111111111114111811111111111ABCD",
            " 11111111-1111-4111-8111-11111111ABCD",
        ] {
            assert!(subscription_id(invalid).is_none());
        }
    }

    #[test]
    fn discovery_keeps_only_distinct_valid_components_in_the_selected_subscription() {
        let subscription = subscription_id("11111111-1111-4111-8111-111111111111").unwrap();
        let prefix = format!("/subscriptions/{subscription}/resourceGroups");
        let first = format!("{prefix}/qa/providers/Microsoft.Insights/components/checkout");
        let second =
            format!("{prefix}/Équipe/providers/Microsoft.Insights/components/Café checkout");
        let bytes = serde_json::to_vec(&[
            first.clone(),
            first.to_ascii_uppercase(),
            second.clone(),
            second.to_uppercase(),
            first.replace(
                &subscription.to_string(),
                "22222222-2222-4222-8222-222222222222",
            ),
            first.replace("Microsoft.Insights", "Microsoft.Web"),
            first.replace("/qa/", "/../"),
            format!("{first}/unexpected"),
        ])
        .unwrap();
        let components = parse_components(&bytes, subscription).unwrap();
        assert_eq!(
            components
                .iter()
                .map(|value| value.resource_id.as_str())
                .collect::<Vec<_>>(),
            [&first, &second]
        );
        assert_eq!(
            (&*components[0].name, &*components[0].resource_group),
            ("checkout", "qa")
        );
        assert_eq!(
            parse_components(b"{}", subscription).err(),
            Some(LogQueryError::InvalidResponse)
        );
    }
}
