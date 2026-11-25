use std::io::Read;

use base64::{Engine, engine::general_purpose::STANDARD};
use flate2::read::GzDecoder;
use percent_encoding::percent_decode_str;
use qa_scribe_core::domain::{ApplicationLogQuery, ApplicationLogSource, LOG_RESULT_MAX_BYTES};
use serde_json::json;

use super::*;

fn query() -> ValidatedApplicationLogQuery {
    let source = ApplicationLogSource {
        label: "Acceptance A".into(),
        resource_id: "/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/acpt/providers/Microsoft.Insights/components/first".into(),
    };
    ApplicationLogQuery {
        target_id: source.resource_id.clone(),
        kql: "traces | summarize count()".into(),
        start: "2026-11-24T09:00:00Z".into(),
        end: "2026-11-24T09:15:00Z".into(),
    }
    .validate(&[source])
    .unwrap()
}

#[test]
fn exact_arguments_use_one_target_and_a_separate_kql_file() {
    let query = query();
    let args = command_args(&query, Path::new("/tmp/qa test/evidence.kql"));
    let strings: Vec<_> = args.iter().map(|arg| arg.to_str().unwrap()).collect();
    assert_eq!(
        strings,
        [
            "monitor",
            "app-insights",
            "query",
            "--apps",
            &query.target.resource_id,
            "--analytics-query",
            "@/tmp/qa test/evidence.kql",
            "--start-time",
            &query.start,
            "--end-time",
            &query.end,
            "-o",
            "json",
        ]
    );
}

fn result_bytes(rows: serde_json::Value) -> Vec<u8> {
    serde_json::to_vec(&json!({"tables":[{
        "name":"PrimaryResult",
        "columns":[{"name":"Message","type":"string"}],
        "rows": rows
    }]}))
    .unwrap()
}

#[test]
fn portal_link_round_trips_the_query_using_the_example_route() {
    let query = query();
    let result = response::capture(&query, &result_bytes(json!([]))).unwrap();
    let (route, encoded_query) = result.portal_url.split_once("/q/").unwrap();
    assert!(route.starts_with("https://portal.azure.com/#view/Microsoft_OperationsManagementSuite_Workspace/Logs.ReactView/"));
    assert_eq!(
        percent_decode_str(
            route
                .split("/resourceId/")
                .nth(1)
                .unwrap()
                .split("/source/")
                .next()
                .unwrap()
        )
        .decode_utf8()
        .unwrap(),
        query.target.resource_id
    );
    assert!(!encoded_query.contains('/'));
    let compressed = STANDARD
        .decode(
            percent_decode_str(encoded_query)
                .decode_utf8()
                .unwrap()
                .as_bytes(),
        )
        .unwrap();
    let mut decoded = String::new();
    GzDecoder::new(&compressed[..])
        .read_to_string(&mut decoded)
        .unwrap();
    assert_eq!(decoded, query.kql);
}

#[test]
fn empty_rows_differ_from_a_first_row_that_exceeds_the_cap() {
    let empty = response::capture(&query(), &result_bytes(json!([]))).unwrap();
    assert_eq!(empty.row_count, 0);
    assert!(!empty.truncated);
    let oversized = result_bytes(json!([["a".repeat(LOG_RESULT_MAX_BYTES)]]));
    assert!(matches!(
        response::capture(&query(), &oversized),
        Err(LogQueryError::TooMuchOutput)
    ));
}

#[test]
fn partial_or_malformed_output_is_rejected_even_beyond_the_row_cap() {
    let mut rows = vec![json!(["valid"]); 501];
    rows.push(json!([]));
    let partial = json!({
        "error": {"code": "PartialError"},
        "tables": [{"name":"PrimaryResult","columns":[{"name":"Message","type":"string"}],"rows":[["valid"]]}]
    });
    for bytes in [
        b"{".to_vec(),
        br#"{"tables":[]}"#.to_vec(),
        partial.to_string().into_bytes(),
        result_bytes(json!(rows)),
    ] {
        assert!(matches!(
            response::capture(&query(), &bytes),
            Err(LogQueryError::InvalidResponse)
        ));
    }
}

#[test]
fn limits_rows_and_bytes_even_when_clis_return_large_responses() {
    let capture = |rows| response::capture(&query(), &result_bytes(json!(rows))).unwrap();
    let rows = capture(vec![["text".to_owned()]; 501]);
    assert_eq!(rows.row_count, 500);
    assert!(rows.truncated);
    let bytes = capture(vec![["a".repeat(152_000)]; 2]);
    assert_eq!(bytes.row_count, 1);
    assert!(bytes.truncated);
    assert!(bytes.result_json.len() <= LOG_RESULT_MAX_BYTES);
}

#[test]
fn signed_out_and_denied_can_both_exit_one() {
    assert_eq!(
        response::classify_error("ERROR: Please run 'az login' to setup account."),
        ApplicationLogAccess::SignedOut
    );
    assert_eq!(
        response::classify_error(
            "ERROR: Can't find token from MSAL cache.\nTo re-authenticate, please run:\n  az login"
        ),
        ApplicationLogAccess::SignedOut
    );
    assert_eq!(
        response::classify_error(
            "ERROR: (AuthorizationFailed) Access denied. Run 'az login' with another account."
        ),
        ApplicationLogAccess::AccessDenied
    );
    assert_eq!(
        response::classify_error(
            "ERROR: 'app-insights' is misspelled or not recognized by the system."
        ),
        ApplicationLogAccess::ExtensionMissing
    );
    assert_eq!(
        response::classify_error("ERROR: Invalid query syntax."),
        ApplicationLogAccess::Failed
    );
}

#[cfg(unix)]
#[test]
fn sign_in_uses_fixed_arguments_with_closed_input_and_terminates_on_timeout() {
    use std::os::unix::fs::PermissionsExt;

    let cwd = tempfile::tempdir().unwrap();
    let az = cwd.path().join("az");
    std::fs::write(&az, "#!/bin/sh\nset -eu\n[ \"$#\" -eq 3 ] && [ \"$*\" = 'login --output none' ] || exit 1\nif read -r line; then exit 1; fi\necho sensitive-output\necho sensitive-error >&2\n").unwrap();
    std::fs::set_permissions(&az, std::fs::Permissions::from_mode(0o700)).unwrap();
    let cancelled = AtomicBool::new(false);
    assert_eq!(
        sign_in_cli(&az, cwd.path(), &cancelled, Duration::from_secs(3)),
        Ok(())
    );
    std::fs::write(&az, "#!/bin/sh\nsleep 30 &\nwait\n").unwrap();
    assert_eq!(
        sign_in_cli(&az, cwd.path(), &cancelled, Duration::from_millis(60)),
        Err(LogQueryError::Access(ApplicationLogAccess::TimedOut))
    );
    cancelled.store(true, Ordering::Release);
    assert_eq!(
        sign_in_cli(&az, cwd.path(), &cancelled, Duration::from_secs(3)),
        Err(LogQueryError::Cancelled)
    );
}

#[cfg(unix)]
#[test]
fn timeout_and_cancellation_stop_child_processes() {
    use std::os::unix::fs::PermissionsExt;

    let temp = tempfile::tempdir().unwrap();
    let az = temp.path().join("az");
    std::fs::write(&az, "#!/bin/sh\nsleep 30 &\nwait\n").unwrap();
    std::fs::set_permissions(&az, std::fs::Permissions::from_mode(0o700)).unwrap();
    let cancelled = AtomicBool::new(false);
    assert!(matches!(
        execute(&az, &query(), &cancelled, Duration::from_millis(60)),
        Err(LogQueryError::Access(ApplicationLogAccess::TimedOut)),
    ));
    std::thread::scope(|scope| {
        scope.spawn(|| {
            std::thread::sleep(Duration::from_millis(120));
            cancelled.store(true, Ordering::Release);
        });
        assert!(matches!(
            execute(&az, &query(), &cancelled, Duration::from_secs(3)),
            Err(LogQueryError::Cancelled)
        ));
    });
}

#[cfg(unix)]
#[test]
fn successful_exit_still_checks_stderr_and_releases_descendant_pipes() {
    use std::os::unix::fs::PermissionsExt;

    let temp = tempfile::tempdir().unwrap();
    let az = temp.path().join("az");
    let execute_fixture = |stderr_script| {
        let json = String::from_utf8(result_bytes(json!([]))).unwrap();
        std::fs::write(
            &az,
            format!("#!/bin/sh\nprintf '%s' '{json}'\n{stderr_script}\n"),
        )
        .unwrap();
        std::fs::set_permissions(&az, std::fs::Permissions::from_mode(0o700)).unwrap();
        execute(
            &az,
            &query(),
            &AtomicBool::new(false),
            Duration::from_secs(2),
        )
    };
    assert!(matches!(
        execute_fixture("echo 'WARNING: Partial query failure' >&2"),
        Err(LogQueryError::InvalidResponse)
    ));
    assert!(matches!(
        execute_fixture("head -c 20000 /dev/zero >&2; exit 0"),
        Err(LogQueryError::InvalidResponse)
    ));
    assert!(matches!(
        execute_fixture(
            "echo \"ERROR: Please run 'az login' to setup account.\" >&2; head -c 20000 /dev/zero >&2; exit 1"
        ),
        Err(LogQueryError::Access(ApplicationLogAccess::SignedOut))
    ));
    let started = Instant::now();
    assert!(execute_fixture("sleep 30 &").is_ok());
    assert!(started.elapsed() < Duration::from_secs(2));
}
