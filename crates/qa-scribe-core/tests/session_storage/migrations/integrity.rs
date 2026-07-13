#[test]
fn current_schema_open_skips_full_foreign_key_scan() {
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let database_path = temp_dir.join("current-schema-corrupt.sqlite");

    drop(Database::open(&database_path).expect("current database should initialize"));

    {
        let connection = rusqlite::Connection::open(&database_path)
            .expect("current database should reopen for fixture setup");
        connection
            .execute_batch(
                r#"
                PRAGMA foreign_keys = OFF;

                INSERT INTO entries (
                  id, session_id, type, title, body, body_json, body_format,
                  metadata_json, excluded_from_generation, created_at, updated_at
                )
                VALUES (
                  'orphan-entry', 'missing-session', 'note', 'Orphan note', '<p>Body</p>',
                  NULL, 'html', NULL, 0,
                  '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z'
                );
                "#,
            )
            .expect("orphan fixture should be inserted");
    }

    let database = Database::open(&database_path)
        .expect("current-schema open should not run the full startup FK scan");
    assert_eq!(foreign_key_violation_count(database.connection()), 1);

    drop(database);
    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}
#[test]
fn migration_open_still_rejects_foreign_key_violations() {
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let database_path = temp_dir.join("migration-corrupt.sqlite");

    drop(Database::open(&database_path).expect("current database should initialize"));

    {
        let connection = rusqlite::Connection::open(&database_path)
            .expect("current database should reopen for fixture setup");
        connection
            .execute_batch(&format!(
                r#"
                PRAGMA foreign_keys = OFF;

                INSERT INTO entries (
                  id, session_id, type, title, body, body_json, body_format,
                  metadata_json, excluded_from_generation, created_at, updated_at
                )
                VALUES (
                  'orphan-entry', 'missing-session', 'note', 'Orphan note', '<p>Body</p>',
                  NULL, 'html', NULL, 0,
                  '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z'
                );

                PRAGMA user_version = {};
                "#,
                SCHEMA_VERSION - 1
            ))
            .expect("orphan migration fixture should be inserted");
    }

    match Database::open(&database_path) {
        Err(QaScribeError::Validation(message)) => {
            assert!(
                message.contains("database migration left a foreign key violation"),
                "unexpected validation message: {message}"
            );
        }
        Ok(_) => panic!("migration open should reject the foreign key violation"),
        Err(error) => panic!("expected validation error, got {error:?}"),
    }

    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}

fn foreign_key_violation_count(connection: &rusqlite::Connection) -> usize {
    let mut statement = connection
        .prepare("PRAGMA foreign_key_check")
        .expect("foreign key check should prepare");
    let rows = statement
        .query_map([], |_| Ok(()))
        .expect("foreign key check should run");
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .expect("foreign key rows should collect")
        .len()
}
