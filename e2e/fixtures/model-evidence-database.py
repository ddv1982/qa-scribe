import hashlib
import json
from pathlib import Path
import sqlite3
import sys


def seed(database, schema, receipt):
    assert not database.exists(), 'Legacy evidence database must be seeded before its first native launch'
    source = schema.read_text()
    with sqlite3.connect(database) as connection:
        connection.executescript(source)
        columns = [row[1] for row in connection.execute('PRAGMA table_info(ai_runs)')]
        version = connection.execute('PRAGMA user_version').fetchone()[0]
        assert version == 10 and 'model_selection_json' not in columns
        time = '2026-10-16T10:00:00Z'
        connection.execute('INSERT INTO sessions(id,title,created_at,updated_at,last_opened_at) VALUES(?,?,?,?,?)',
                           ('model-evidence-legacy-session', 'M02 legacy schema 10', time, time, time))
        connection.execute("INSERT INTO entries(id,session_id,type,body,created_at,updated_at) VALUES(?,?,'note',?,?,?)",
                           ('model-evidence-legacy-note', 'model-evidence-legacy-session', '<p>Preserved legacy evidence.</p>', time, time))
        connection.execute('INSERT INTO ai_runs(id,session_id,provider,model,prompt_version,status,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?)',
                           ('model-evidence-legacy-run', 'model-evidence-legacy-session', 'claude_code', 'ambiguous-old-model',
                            'legacy-evidence-fixture-v10', 'completed', time, time))
    receipt.write_text(json.dumps({'schemaVersion': version, 'aiRunColumns': columns,
                                   'schemaSha256': hashlib.sha256(source.encode()).hexdigest(),
                                   'legacyRunId': 'model-evidence-legacy-run'}, indent=2) + '\n')


def snapshot(database, session_id):
    with sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True) as connection:
        connection.row_factory = sqlite3.Row
        runs = [dict(row) for row in connection.execute(
            'SELECT id,session_id,provider,model,model_selection_json,status,error_message FROM ai_runs WHERE session_id = ? ORDER BY rowid',
            (session_id,))]
        for run in runs:
            run['selection'] = json.loads(run['model_selection_json']) if run['model_selection_json'] is not None else None
        return {'schemaVersion': connection.execute('PRAGMA user_version').fetchone()[0], 'runs': runs,
                'foreignKeyViolations': [list(row) for row in connection.execute('PRAGMA foreign_key_check')]}


if __name__ == '__main__':
    operation, *arguments = sys.argv[1:]
    if operation == 'seed':
        seed(*map(Path, arguments))
    elif operation == 'read':
        print(json.dumps(snapshot(Path(arguments[0]), arguments[1])))
    else:
        raise ValueError('Expected explicit seed or read operation')
