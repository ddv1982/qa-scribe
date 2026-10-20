import ctypes
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import traceback


def interrupted(signum, frame):
    raise RuntimeError(f"fixture interrupted by signal {signum}")


signal.signal(signal.SIGTERM, interrupted)
libc = ctypes.CDLL(None, use_errno=True)
if libc.prctl(36, 1, 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), "PR_SET_CHILD_SUBREAPER failed")

frontend = Path.cwd()
port = json.loads((frontend / "fixture.json").read_text())["port"]
groups = set()
owned = set()
report = {}
entry = None


def observe():
    processes = {}
    for path in Path("/proc").iterdir():
        if not path.name.isdigit():
            continue
        try:
            stat = (path / "stat").read_text()
        except (FileNotFoundError, ProcessLookupError):
            continue
        fields = stat[stat.rfind(")") + 1:].split()
        processes[int(path.name)] = {
            "pid": int(path.name), "state": fields[0],
            "ppid": int(fields[1]), "pgid": int(fields[2]),
        }
    while True:
        added = {pid for pid, row in processes.items()
                 if row["ppid"] == os.getpid() or row["ppid"] in owned or row["pgid"] in groups} - owned
        if not added:
            break
        owned.update(added)
    groups.update(processes[pid]["pgid"] for pid in owned if pid in processes)
    return [row for pid, row in processes.items() if pid in owned or row["pgid"] in groups]


def port_free():
    with socket.socket() as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


log = frontend / "zombie-cli.log"
with log.open("wb") as output:
    try:
        entry = subprocess.Popen([sys.argv[1], sys.argv[2], "checked"],
                                 stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        owned.add(entry.pid)
        groups.add(entry.pid)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            observe()
            journal = frontend / "pids.jsonl"
            if journal.exists():
                rows = [json.loads(line) for line in journal.read_text().splitlines() if line]
                if {row["role"] for row in rows} == {"ui", "config", "vite", "native"} and (frontend / "listening").exists():
                    break
            assert entry.poll() is None, "CLI exited before fixture readiness"
            time.sleep(0.02)
        else:
            raise TimeoutError("fixture readiness")
        assert not port_free(), "fixture must own its listener before interruption"
        entry.send_signal(signal.SIGINT)
        report["entry_exit_code"] = entry.wait(timeout=3)
        remaining = observe()
        report["before_reap"] = remaining
        assert remaining and all(row["state"] == "Z" for row in remaining), remaining
        report["live_members_before_reap"] = [row for row in remaining if row["state"] != "Z"]
        zombie_groups = sorted({row["pgid"] for row in remaining})
        for group in zombie_groups:
            os.killpg(group, 0)
        report["zombie_groups_still_exist"] = zombie_groups
        report["port_free_before_reap"] = port_free()
        assert report["port_free_before_reap"]
    except Exception:
        report["failure"] = traceback.format_exc()
    finally:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        try:
            observe()
        except Exception:
            report["cleanup_observation_failure"] = traceback.format_exc()
        for group in groups:
            try:
                os.killpg(group, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if entry is not None:
            entry.wait(timeout=2)
        reaped = []
        report["all_children_reaped"] = False
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            try:
                pid, status = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                report["all_children_reaped"] = True
                break
            if pid:
                reaped.append({"pid": pid, "status": status})
            else:
                children = Path(f"/proc/self/task/{os.getpid()}/children").read_text().split()
                for child in children:
                    try:
                        os.kill(int(child), signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                time.sleep(0.01)
        report["reaped_adopted_children"] = reaped
        report["survivors_after_reap"] = observe()
        report["port_free_after_reap"] = port_free()
        assert report["all_children_reaped"] and not report["survivors_after_reap"], report
        for group in groups:
            try:
                os.killpg(group, 0)
            except ProcessLookupError:
                continue
            raise AssertionError(f"owned group {group} remains after reaping")
        report["all_groups_gone_after_reap"] = True

report["output"] = log.read_text()
print(json.dumps(report))
sys.exit(1 if "failure" in report or "cleanup_observation_failure" in report else 0)
