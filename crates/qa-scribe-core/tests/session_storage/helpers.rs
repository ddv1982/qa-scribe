use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn count_rows(connection: &rusqlite::Connection, table: &str) -> i64 {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    connection
        .query_row(&sql, [], |row| row.get(0))
        .expect("count query should succeed")
}

pub(crate) fn assert_no_foreign_key_violations(connection: &rusqlite::Connection) {
    let mut statement = connection
        .prepare("PRAGMA foreign_key_check")
        .expect("foreign key check should prepare");
    let mut rows = statement.query([]).expect("foreign key check should run");
    assert!(
        rows.next()
            .expect("foreign key check row should be readable")
            .is_none(),
        "database should not have foreign key violations"
    );
}

pub(crate) fn unique_temp_dir() -> std::path::PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("qa-scribe-test-{nanos}"))
}
