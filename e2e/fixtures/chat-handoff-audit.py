import json
import sqlite3
import sys

connection = sqlite3.connect(sys.argv[2], timeout=5)
if sys.argv[1] == 'start':
    connection.executescript('''
        CREATE TABLE ux5_note_updates (note_id TEXT, before_body TEXT, after_body TEXT);
        CREATE TRIGGER ux5_note_update AFTER UPDATE OF body, body_json, body_format ON entries
        WHEN NEW.type = 'note'
        BEGIN
            INSERT INTO ux5_note_updates VALUES (NEW.id, OLD.body, NEW.body);
        END;
    ''')
    connection.commit()
else:
    rows = connection.execute('SELECT note_id, before_body, after_body FROM ux5_note_updates').fetchall()
    print(json.dumps([dict(zip(['noteId', 'before', 'after'], row)) for row in rows]))
