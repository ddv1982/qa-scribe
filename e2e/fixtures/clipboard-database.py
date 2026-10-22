import json
import sqlite3
import sys

mode, path = sys.argv[1:]
tables = ('sessions', 'entries', 'drafts', 'findings')
with sqlite3.connect(path, timeout=5) as database:
    if mode == 'start':
        database.execute('CREATE TABLE ux4_copy_audit (table_name TEXT, operation TEXT, record_id TEXT)')
        for table in tables:
            for operation in ('INSERT', 'UPDATE', 'DELETE'):
                row = 'OLD' if operation == 'DELETE' else 'NEW'
                database.execute(f'''CREATE TRIGGER ux4_audit_{table}_{operation}
                    AFTER {operation} ON {table}
                    BEGIN INSERT INTO ux4_copy_audit VALUES ('{table}', '{operation}', {row}.id); END''')
    elif mode == 'read':
        print(json.dumps(database.execute('SELECT table_name, operation, record_id FROM ux4_copy_audit').fetchall()))
    elif mode == 'stop':
        for table in tables:
            for operation in ('INSERT', 'UPDATE', 'DELETE'):
                database.execute(f'DROP TRIGGER ux4_audit_{table}_{operation}')
        database.execute('DROP TABLE ux4_copy_audit')
    else:
        raise ValueError(f'Unknown clipboard audit mode: {mode}')
