import argparse
from contextlib import closing
import hashlib
import json
import pathlib
import re
import sqlite3
import shutil
import subprocess
import uuid


ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = "51189e3a388c12a53dd7c18eeb79571bad437902"
TABLES = ["chat_drafts", "chat_messages", "chat_message_images", "chat_composer_images",
          "chat_message_contexts", "chat_response_contracts", "chat_response_messages",
          "chat_refinements", "chat_editor_stages", "chat_answers", "attachments", "entries"]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def snapshot(root, columns=None, after_ui=False):
    database = root / "qa-scribe.sqlite"
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as db:
        assert db.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        tables = {}
        for table in TABLES:
            names = columns[table]["columns"] if columns else [r[1] for r in db.execute(f'PRAGMA table_info("{table}")')]
            selected = ",".join(f'"{name}"' for name in names)
            rows = [list(row) for row in db.execute(f'SELECT {selected} FROM "{table}"')]
            if after_ui and table == "chat_drafts":
                active = next(row for row in rows if row[names.index("id")] == "perf-chat")
                assert active[names.index("revision")] >= 1
                active[names.index("revision")] = 1
            rows.sort(key=lambda row: json.dumps(row))
            tables[table] = {"columns": names, "rows": len(rows), "sha256": sha(json.dumps(rows, separators=(",", ":"), ensure_ascii=False).encode())}
        version = db.execute("PRAGMA user_version").fetchone()[0]
        images = [{"id": row[0], "relativePath": row[1], "bytes": row[2], "sha256": row[3]} for row in db.execute("SELECT id,relative_path,size_bytes,sha256 FROM attachments ORDER BY id")]
        for image in images:
            image_path = (root / image["relativePath"]).resolve()
            assert root.resolve() in image_path.parents
            data = image_path.read_bytes()
            assert len(data) == image["bytes"] and sha(data) == image["sha256"]
    return {"schemaVersion": version, "tables": tables, "images": images}



def materialize(root):
    assert not root.exists(), "Use a new disposable fixture directory"
    subprocess.run(["node", "--input-type=module", "-e", "import { prepareOwnershipFixture } from './scripts/prepare-ask-ai-ownership.mjs'; prepareOwnershipFixture(process.argv[1])", str(root)], cwd=ROOT, check=True)
    source = ROOT / "crates/qa-scribe-core/tests/fixtures/ask-ai-schema18"
    for name in ["ask-ai-isolation-fixture.json", "ui-perf-fixture.json"]:
        shutil.copyfile(source / name, root / name)
    manifest = json.loads((root / "ask-ai-isolation-fixture.json").read_text())
    actual = snapshot(root, manifest["snapshot"]["tables"])
    assert actual["schemaVersion"] == 18
    assert actual["tables"] == manifest["snapshot"]["tables"]
    assert sha((root / "qa-scribe.sqlite").read_bytes()) == manifest["databaseSha256"]
    print(json.dumps({"materializedFrozenFixture": True, "databaseSha256": manifest["databaseSha256"]}))


def generate(root, target):
    assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip() == BASE
    assert not root.exists(), "Use a new disposable fixture directory"
    for name in ["generate_ui_perf_fixture", "generate_ask_ai_isolation_fixture"]:
        subprocess.run([str(target / "release/examples" / name), str(root)], check=True)
    database = root / "qa-scribe.sqlite"
    with closing(sqlite3.connect(database)) as db:
        dump = "\n".join(db.iterdump())
    ids = {}
    def stable_id(match):
        raw = match[0]
        if raw not in ids:
            ids[raw] = str(uuid.uuid5(uuid.NAMESPACE_URL, f"qa-scribe-isolation-fixture-v1/{len(ids)}"))
        return ids[raw]
    dump = re.sub(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", stable_id, dump)
    dump = re.sub(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)", "2026-01-01T00:00:00Z", dump)
    normalized = root / "canonical.sqlite"
    with closing(sqlite3.connect(normalized)) as db:
        db.executescript(dump)
        db.execute("PRAGMA user_version=18")
        db.commit()
        db.execute("VACUUM")
    normalized.replace(database)
    for suffix in ["-wal", "-shm"]:
        assert not pathlib.Path(str(database) + suffix).exists()
    subprocess.run([str(target / "release/examples/generate_ask_ai_isolation_fixture"), str(root), "--verify"], check=True)
    evidence = snapshot(root)
    assert evidence["schemaVersion"] == 18
    assert evidence["tables"]["chat_drafts"]["rows"] == 103
    assert evidence["tables"]["chat_messages"]["rows"] == 1120
    assert evidence["tables"]["attachments"]["rows"] == 4
    assert evidence["tables"]["chat_editor_stages"]["rows"] == 3
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as db:
        assert db.execute("SELECT count(*) FROM chat_drafts WHERE archived=1").fetchone()[0] == 100
        assert db.execute("SELECT count(*) FROM (SELECT draft_id,count(*) AS n FROM chat_messages WHERE draft_id LIKE 'isolation-history-%' GROUP BY draft_id HAVING n=10)").fetchone()[0] == 100
        assert db.execute("SELECT count(*) FROM ai_runs").fetchone()[0] == 0
        mixed = [json.loads(row[0]) for row in db.execute("SELECT proposal_json FROM chat_refinements ORDER BY rowid")]
        assert [p["target"]["kind"] for p in mixed] == ["finding", "finding", "test_cases_draft"]
        assert all(p["state"]["kind"] == "staged" for p in mixed)
        assert mixed[0]["target"]["snapshot"]["recordId"] == mixed[1]["target"]["snapshot"]["recordId"]
        assert db.execute("SELECT composer FROM chat_drafts WHERE id='perf-chat'").fetchone()[0] == "ISOLATION_ACTIVE_UNSENT_INPUT"
    manifest = {"schema": "qa-scribe-ask-ai-isolation-fixture-v1", "sourceSha": BASE,
                "canonicalization": "Public service UUIDs become stable UUIDv5 values in dump encounter order. UTC timestamps become 2026-01-01. Schema, triggers and rows are otherwise retained. The canonical fixture must pass public core reopen validation before use.",
                "sqliteVersion": sqlite3.sqlite_version, "historicalConversations": 100,
                "historicalMessagesEach": 10, "mainActiveMessages": 100,
                "submittedMessages": 10, "mixedMessages": 10, "competingFindingStages": 2,
                "databaseBytes": database.stat().st_size, "databaseSha256": sha(database.read_bytes()),
                "snapshot": evidence, "providerInvoked": False}
    (root / "ask-ai-isolation-fixture.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({key: manifest[key] for key in ["schema", "databaseBytes", "databaseSha256"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=["generate", "verify", "materialize"])
    parser.add_argument("directory", type=pathlib.Path)
    parser.add_argument("--target", type=pathlib.Path, default=ROOT / "target/ask-ai-isolation-baseline")
    parser.add_argument("--after-ui", action="store_true", help="Allow only perf-chat revision growth from native mode toggles")
    args = parser.parse_args()
    directory = args.directory.resolve()
    if args.operation == "materialize":
        materialize(directory)
    elif args.operation == "generate":
        generate(directory, args.target.resolve())
    else:
        manifest = json.loads((directory / "ask-ai-isolation-fixture.json").read_text())
        actual = snapshot(directory, manifest["snapshot"]["tables"], after_ui=args.after_ui)
        assert actual["tables"] == manifest["snapshot"]["tables"], "Legacy rows changed"
        assert actual["images"] == manifest["snapshot"]["images"]
        print(json.dumps({"legacyRowsConserved": True, "activeUiRevisionGrowthAllowed": args.after_ui, "schemaVersion": actual["schemaVersion"], "snapshot": actual}))
