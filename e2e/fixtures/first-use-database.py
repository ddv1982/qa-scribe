"""Audit writes in the disposable first-use fixture database, never production data."""
import json
from pathlib import Path
import sqlite3
import sys

mode, filename = sys.argv[1:]
path = Path(filename).resolve()
if not path.is_file():
    raise ValueError(f"Expected an existing fixture database: {path}")


def quote(identifier):
    return '"' + identifier.replace('"', '""') + '"'


with sqlite3.connect(path, timeout=5) as database:
    if mode == 'start':
        tables = [row[0] for row in database.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )]
        database.execute('CREATE TABLE ac3_write_audit (table_name TEXT, operation TEXT)')
        for index, table in enumerate(tables):
            for operation in ('INSERT', 'UPDATE', 'DELETE'):
                table_literal = table.replace("'", "''")
                database.execute(f'''CREATE TRIGGER ac3_audit_{index}_{operation}
                    AFTER {operation} ON {quote(table)}
                    BEGIN INSERT INTO ac3_write_audit VALUES ('{table_literal}', '{operation}'); END''')
        print(json.dumps({'auditedTables': tables}))
    elif mode == 'read':
        print(json.dumps(database.execute('SELECT table_name, operation FROM ac3_write_audit').fetchall()))
    elif mode == 'stop':
        triggers = [row[0] for row in database.execute(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'ac3_audit_%'"
        )]
        for trigger in triggers:
            database.execute(f'DROP TRIGGER {quote(trigger)}')
        database.execute('DROP TABLE ac3_write_audit')
        print(json.dumps({'stopped': True}))
    else:
        raise ValueError(f'Unknown audit mode: {mode}')
