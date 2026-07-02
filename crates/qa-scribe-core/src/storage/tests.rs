use super::*;

fn user_version(connection: &Connection) -> i32 {
    connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("user_version should read")
}

#[test]
fn fresh_database_lands_on_current_schema_version() {
    let connection = Connection::open_in_memory().expect("in-memory database should open");
    initialize(&connection).expect("fresh database should initialize");

    assert_eq!(user_version(&connection), SCHEMA_VERSION);
}

#[test]
fn reopen_at_current_version_skips_migrations() {
    let temp_dir = std::env::temp_dir().join(format!(
        "qa-scribe-schema-version-test-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos()
    ));
    std::fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let database_path = temp_dir.join("versioned.sqlite");

    {
        let connection = Connection::open(&database_path).expect("database should open for setup");
        initialize(&connection).expect("database should initialize");
        assert_eq!(user_version(&connection), SCHEMA_VERSION);

        // Undo a migration's effect without touching user_version, so a
        // reopen that actually re-runs migrations would visibly heal
        // this column back into existence. A reopen that correctly
        // skips migrations (because user_version already reads as
        // current) must leave this column missing.
        connection
            .execute_batch("ALTER TABLE drafts DROP COLUMN metadata_json;")
            .expect("drafts.metadata_json should be droppable for the test setup");
        assert!(!table_has_column(&connection, "drafts", "metadata_json").unwrap());
    }

    {
        let connection = Connection::open(&database_path).expect("database should reopen");
        initialize(&connection).expect("reopen should initialize without error");

        assert_eq!(user_version(&connection), SCHEMA_VERSION);
        assert!(
            !table_has_column(&connection, "drafts", "metadata_json").unwrap(),
            "migrations re-ran on reopen even though user_version was already current"
        );
    }

    std::fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}

#[test]
fn stale_current_era_user_version_still_triggers_one_more_migration_pass() {
    // Databases produced by the pre-versioning code always ended up with
    // user_version = 5 (unconditionally set by `migrate`), regardless of
    // whether every migration had actually applied. SCHEMA_VERSION must
    // be strictly greater than that legacy constant so those databases
    // run the (idempotent) migration helpers one final time and settle
    // on a value that is trustworthy going forward.
    let connection = Connection::open_in_memory().expect("in-memory database should open");
    connection
        .execute_batch(SCHEMA)
        .expect("schema should create fresh tables");
    connection
        .pragma_update(None, "user_version", 5)
        .expect("legacy user_version should be settable");

    initialize(&connection).expect("legacy-versioned database should initialize");

    assert_eq!(user_version(&connection), SCHEMA_VERSION);
    assert!(table_has_column(&connection, "drafts", "metadata_json").unwrap());
}
