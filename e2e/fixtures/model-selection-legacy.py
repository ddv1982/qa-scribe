from pathlib import Path
import sqlite3
import sys

with sqlite3.connect(Path(sys.argv[1])) as connection:
    assert connection.execute('PRAGMA user_version').fetchone()[0] == 10
    time = '2026-10-16T10:00:00Z'
    connection.execute('INSERT INTO chat_drafts(id,session_id,created_at) VALUES(?,?,?)',
                       ('model-selection-legacy-chat', 'model-evidence-legacy-session', time))
    for sequence, role, text in [(0, 'user', 'A preserved legacy question.'), (1, 'assistant', 'A preserved legacy answer.')]:
        connection.execute('INSERT INTO chat_messages(id,draft_id,turn_id,sequence,role,text,status,ai_run_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
                           (f'model-selection-legacy-message-{sequence}', 'model-selection-legacy-chat', 'model-selection-legacy-turn',
                            sequence, role, text, 'completed', 'model-evidence-legacy-run', time))
