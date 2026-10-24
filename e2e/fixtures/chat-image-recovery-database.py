import hashlib
import json
from pathlib import Path
import sqlite3
import sys

root = Path(sys.argv[1]).resolve()
session_id = sys.argv[2]
observed = json.loads(sys.argv[3])
database = root / 'qa-scribe.sqlite'
with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True, timeout=5) as connection:
    connection.execute('PRAGMA query_only=ON')
    connection.row_factory = sqlite3.Row
    attachments = [dict(row) for row in connection.execute(
        'SELECT id, filename, relative_path, sha256, size_bytes FROM attachments WHERE session_id = ? ORDER BY id', (session_id,))]
    composer = [row[0] for row in connection.execute(
        'SELECT i.attachment_id FROM chat_composer_images i JOIN chat_drafts d ON d.id = i.draft_id WHERE d.session_id = ? ORDER BY i.ordinal', (session_id,))]
    messages = connection.execute(
        'SELECT count(*) FROM chat_messages m JOIN chat_drafts d ON d.id = m.draft_id WHERE d.session_id = ?', (session_id,)).fetchone()[0]
    runs = connection.execute('SELECT count(*) FROM ai_runs WHERE session_id = ?', (session_id,)).fetchone()[0]
    imports = connection.execute('SELECT count(*) FROM chat_image_imports WHERE session_id = ?', (session_id,)).fetchone()[0]
    cleanup = [row[0] for row in connection.execute('SELECT relative_path FROM chat_image_cleanup WHERE session_id = ?', (session_id,))]
    version = connection.execute('PRAGMA user_version').fetchone()[0]
    violations = [list(row) for row in connection.execute('PRAGMA foreign_key_check')]

files = []
for relative in sorted(set(observed + [row['relative_path'] for row in attachments])):
    path = (root / relative).resolve()
    assert path.is_relative_to(root / 'attachments' / session_id), 'Read-only receipt must stay inside this Session attachment directory'
    exists = path.is_file()
    files.append({'relativePath': relative, 'exists': exists,
                  'sha256': hashlib.sha256(path.read_bytes()).hexdigest() if exists else None,
                  'sizeBytes': path.stat().st_size if exists else None})
print(json.dumps({'schemaVersion': version, 'attachments': attachments, 'composerIds': composer,
                  'messageCount': messages, 'aiRunCount': runs, 'pendingImports': imports,
                  'pendingCleanup': cleanup, 'foreignKeyViolations': violations, 'files': files}))
