#[test]
fn v26_migration_preserves_runs_and_keeps_log_captures_local_and_immutable() {
    use qa_scribe_core::domain::{
        ApplicationLogQuery, ApplicationLogSource, QueriedApplicationLogs,
    };
    use rusqlite::params;

    let directory = unique_temp_dir();
    fs::create_dir_all(&directory).unwrap();
    let path = directory.join("state.sqlite");
    let open = || SessionService::new(Database::open(&path).unwrap()).unwrap();
    let service = open();
    let run = started_run(&service);
    let other = started_run(&service);
    drop(service);

    let legacy = rusqlite::Connection::open(&path).unwrap();
    legacy
        .execute_batch("DROP TRIGGER chat_log_attachment_detached;
             DROP TRIGGER chat_log_unattached_delete;
             DROP TABLE chat_suggestion_log_captures;
             DROP TABLE chat_log_capture_shares;
             DROP TABLE test_run_log_captures;
             PRAGMA user_version = 26;")
        .unwrap();
    drop(legacy);

    let service = open();
    let connection = service.database().connection();
    let version: i32 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, SCHEMA_VERSION);
    assert_eq!(service.get_test_run(&run.id).unwrap(), run);
    let target = ApplicationLogSource {
        label: "Private log target".into(),
        resource_id: "/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/qa/providers/Microsoft.Insights/components/checkout".into(),
    };
    let before = service
        .test_run_chat_snapshot(&run.session_id, &run.id, Some(&run.cases[1].id))
        .unwrap();
    let query = ApplicationLogQuery {
        target_id: target.resource_id.clone(),
        kql: "print private_query".into(),
        start: "2026-11-24T09:00:00Z".into(),
        end: "2026-11-24T09:15:00Z".into(),
    };
    let attach = || {
        service.attach_application_logs(
        &run.cases[1].id,
        query.clone().validate(std::slice::from_ref(&target)).unwrap(),
        QueriedApplicationLogs {
            row_count: 1,
            truncated: false,
            result_json: r#"{"tables":[{"name":"PrimaryResult","columns":[{"name":"C","type":"string"}],"rows":[["private row"]]}]}"#.into(),
            portal_url: "https://portal.azure.com/#query-bearing-link".into(),
        },
    )
    };
    let capture = attach().unwrap();
    let stored = service.get_test_run(&run.id).unwrap();
    assert_eq!(stored.log_evidence, std::slice::from_ref(&capture));
    assert!(
        service
            .application_log_details(&run.cases[0].id, &capture.id)
            .is_err()
    );
    let details = service
        .application_log_details(&run.cases[1].id, &capture.id)
        .unwrap();
    assert_eq!(details.kql, query.kql);
    assert!(details.result_json.contains("private row"));
    let after = service
        .test_run_chat_snapshot(&run.session_id, &run.id, Some(&run.cases[1].id))
        .unwrap();
    assert!(
        before == after,
        "the Ask AI snapshot should exclude Azure evidence"
    );
    assert!(
        !service
            .test_run_report(&run.session_id, &run.id)
            .unwrap()
            .contains("portal.azure.com")
    );
    assert_eq!(
        service
            .recent_application_log_queries(&run.cases[1].id, &target.resource_id)
            .unwrap(),
        std::slice::from_ref(&query.kql)
    );
    assert!(
        service
            .recent_application_log_queries(&other.cases[1].id, &target.resource_id)
            .unwrap()
            .is_empty()
    );

    for sql in [
        "UPDATE test_run_log_captures SET kql = 'different' WHERE id = ?1",
        "UPDATE test_run_log_captures SET result_json = '{}' WHERE id = ?1",
        "UPDATE test_run_log_captures SET portal_url = 'https://example.invalid' WHERE id = ?1",
    ] {
        assert!(connection.execute(sql, [&capture.id]).is_err());
    }
    assert!(
        connection
            .execute(
                "UPDATE test_run_log_captures SET case_id = ?2 WHERE id = ?1",
                params![capture.id, other.cases[1].id]
            )
            .is_err()
    );
    let duplicate = "INSERT INTO test_run_log_captures
        (id, session_id, run_id, origin, sources_json, kql, starts_at, ends_at, executed_at,
         row_count, truncated, result_json, portal_url, case_id)
         SELECT 'duplicate', ?2, run_id, origin, sources_json, kql, starts_at, ends_at, executed_at,
         row_count, truncated, result_json, portal_url, case_id FROM test_run_log_captures WHERE id = ?1";
    assert!(
        connection
            .execute(duplicate, params![capture.id, other.session_id])
            .is_err()
    );
    for _ in 1..10 {
        attach().unwrap();
    }
    assert!(
        service
            .require_log_evidence_capacity(&run.cases[1].id)
            .is_err()
    );
    assert!(attach().is_err());
    assert!(
        connection
            .execute(duplicate, params![capture.id, run.session_id])
            .is_err()
    );
    service
        .detach_application_logs(&run.cases[1].id, &capture.id)
        .unwrap();
    assert_eq!(service.get_test_run(&run.id).unwrap().log_evidence.len(), 9);
    assert_eq!(count_rows(connection, "test_run_log_captures"), 10);
    drop(service);

    let service = open();
    let connection = service.database().connection();
    assert_eq!(service.get_test_run(&run.id).unwrap().log_evidence.len(), 9);
    service.delete_draft(&run.draft_id).unwrap();
    assert_eq!(count_rows(connection, "test_run_log_captures"), 0);
    assert_no_foreign_key_violations(connection);
    drop(service);
    fs::remove_dir_all(directory).unwrap();
}
