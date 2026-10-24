"""Deterministic real stdio peer. No provider binary, credentials or network.

Assertions deliberately live in the child, independent of Rust adapter code.
Every inbound message and the actual cwd/argv are recorded for parent checks.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

provider, mode, root, id_kind = sys.argv[1:5]
root = Path(root)
wire_id = 481 if id_kind == "number" else "opaque:permission/481"
original = {"path": "local-fixture-only", "nested": {"raw": True}}
log = root / "wire.jsonl"


def record(value):
    with log.open("a") as stream:
        stream.write(json.dumps(value) + "\n")


def receive():
    line = sys.stdin.readline()
    assert line, "unexpected stdin EOF"
    value = json.loads(line)
    record({"received": value})
    return value


def send(value):
    print(json.dumps(value), flush=True)


def rpc_result(request, result):
    value = {"id": request["id"], "result": result}
    if provider == "copilot":
        value["jsonrpc"] = "2.0"
    send(value)


def text(value, final=False):
    if provider == "claude":
        send({"type": "assistant", "message": {"model": "actualmodel", "content": [
            {"type": "text", "text": value}]}})
    elif provider == "codex":
        if final:
            send({"method": "item/completed", "params": {"threadId": "thread-1",
                  "turnId": "turn-1", "item": {"id": "final", "type": "agentMessage", "text": value}}})
        else:
            send({"method": "item/agentMessage/delta", "params": {"threadId": "thread-1",
                  "turnId": "turn-1", "itemId": "preamble", "delta": value}})
    else:
        send({"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "session-1",
              "update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": value}}}})


def inherited_pipe_descendant():
    # Default subprocess stdio inherits all three provider pipes and its group.
    # The heartbeat proves the descendant really started before parent exit.
    code = """import pathlib,time,sys
p=pathlib.Path(sys.argv[1])
while True:
 with p.open('a') as f: f.write('alive\\n')
 time.sleep(.02)
"""
    child = subprocess.Popen([sys.executable, "-c", code, str(root / "heartbeat")])
    record({"descendant_pid": child.pid})
    deadline = time.monotonic() + 2
    while not (root / "heartbeat").exists():
        assert time.monotonic() < deadline, "heartbeat descendant did not start"
        time.sleep(.002)


def busy_progress():
    if provider == "claude":
        event = {"type": "tool_progress", "tool_use_id": "call-1", "tool_name": "mcp__local__write", "elapsed_time_seconds": 0}
    elif provider == "codex":
        event = {"method": "item/started", "params": {"threadId": "thread-1", "turnId": "turn-1",
                 "item": {"id": "busy", "type": "mcpToolCall", "server": "local", "tool": "write"}}}
    else:
        event = {"method": "session/update", "params": {"sessionId": "session-1", "update": {
            "sessionUpdate": "tool_call_update", "toolCallId": "call-1", "status": "in_progress"}}}
    frame = json.dumps(event) + "\n"
    started = time.monotonic()
    count = 0
    # Bounded bytes, but no intended 10ms quiet gap throughout a full second.
    while count < 100 or time.monotonic() - started < 1:
        assert (count + 1) * len(frame.encode()) < 1024 * 1024
        sys.stdout.write(frame)
        sys.stdout.flush()
        count += 1
        time.sleep(.001)
    record({"busy_frames": count, "busy_seconds": time.monotonic() - started})


record({"argv": sys.argv, "cwd": os.getcwd(), "pid": os.getpid()})
if mode == "silent":
    time.sleep(30)
    sys.exit(9)
if mode == "eof_live":
    os.close(sys.stdout.fileno())
    time.sleep(30)
    sys.exit(9)
if mode == "line":
    sys.stdout.write("x" * 4097)
    sys.stdout.flush()
    time.sleep(30)
    sys.exit(9)

if mode.startswith("replay:"):
    import replay
    replay.run(mode.removeprefix("replay:"), os.getcwd(), sys.argv[5], receive, send, record)
    sys.exit(0)

initial = receive()
if provider == "claude":
    assert initial["type"] == "control_request"
    assert initial["request"]["subtype"] == "initialize"
    send({"type": "control_response", "response": {"subtype": "success",
          "request_id": initial["request_id"], "response": {}}})
    prompt = receive()
    assert prompt["type"] == "user"
    assert prompt["message"]["content"] == "fixture prompt"
else:
    assert initial["method"] == "initialize"
    rpc_result(initial, {"protocolVersion": 1} if provider == "copilot" else {})
    new = receive()
    if provider == "codex":
        assert new["method"] == "initialized"
        new = receive()
        assert new["method"] == "thread/start"
        assert new["params"]["ephemeral"] is True
        assert os.path.samefile(new["params"]["cwd"], os.getcwd())
        for forbidden in ("approvalPolicy", "sandbox", "sandboxPolicy"):
            assert forbidden not in new["params"]
        rpc_result(new, {"thread": {"id": "thread-1"}, "model": "actualmodel"})
        prompt = receive()
        assert prompt["method"] == "turn/start"
        assert prompt["params"]["input"][0]["text"] == "fixture prompt"
        rpc_result(prompt, {"turn": {"id": "turn-1", "status": "inProgress"}})
    else:
        assert new["method"] == "session/new"
        assert set(new["params"]) == {"cwd", "mcpServers"}
        assert new["params"]["mcpServers"] == []
        assert os.path.samefile(new["params"]["cwd"], os.getcwd())
        rpc_result(new, {"sessionId": "session-1"})
        prompt = receive()
        assert prompt["method"] == "session/prompt"
        assert prompt["params"]["prompt"] == [{"type": "text", "text": "fixture prompt"}]

if mode in ("report_eof", "report_invalid", "report_timeout", "report_cancel"):
    text("collected before exit")
    if mode == "report_eof":
        sys.exit(7)
    if mode == "report_invalid":
        print("{invalid", flush=True)
        time.sleep(30)
        sys.exit(9)
    if mode == "report_cancel" and provider == "claude":
        send({"type": "assistant", "message": {"model": "after-cancel", "content": []}})
    time.sleep(30)
    sys.exit(9)

if mode == "total":
    for _ in range(100):
        text("padding" * 30)
    time.sleep(30)
    sys.exit(9)
if mode == "policy":
    sys.stderr.write("Permission denied by configured policy\n")
    sys.stderr.flush()
    sys.exit(7)
if mode == "huge_failure":
    # Valid multibyte UTF-8, larger than the stderr capture tail and much larger
    # than the persisted error bound. Arbitrary byte slicing can split a glyph.
    diagnostic = ("診断🧪" * 40000) + " diagnostic-tail-🧪"
    record({"huge_failure_bytes": len(diagnostic.encode("utf-8"))})
    sys.stderr.buffer.write(diagnostic.encode("utf-8"))
    sys.stderr.buffer.flush()
    sys.exit(7)

if provider == "claude":
    request = {"type": "control_request", "request_id": wire_id, "request": {
        "subtype": "can_use_tool", "tool_name": "mcp__local__write", "input": original}}
elif provider == "codex":
    request = {"id": wire_id, "method": "mcpServer/elicitation/request", "params": {
        "threadId": "thread-1", "turnId": "turn-1", "serverName": "local", "request": {
            "mode": "form", "message": "Allow local.write?", "requestedSchema": {"type": "object", "properties": {}},
            "_meta": {"codex_approval_kind": "mcp_tool_call", "tool_params": original}}}}
else:
    request = {"jsonrpc": "2.0", "id": wire_id, "method": "session/request_permission", "params": {
        "sessionId": "session-1", "toolCall": {"toolCallId": "call-1", "title": "Write local fixture", "rawInput": original},
        "options": [{"optionId": "opaque-yes/481", "kind": "allow_once", "name": "Once"},
                    {"optionId": "opaque-no/481", "kind": "reject_once", "name": "No"}]}}

if mode in ("allow_only_deny", "reject_only_deny"):
    assert provider == "copilot"
    offered = 0 if mode == "allow_only_deny" else 1
    request["params"]["options"] = [request["params"]["options"][offered]]
elif mode == "bad_metadata":
    if provider == "claude":
        request["request"]["tool_name"] = "x" * 513
    elif provider == "codex":
        request["params"]["request"]["_meta"] = {"codex_approval_kind": "unknown"}
    else:
        request["params"]["sessionId"] = "foreign-session"
elif mode == "unsupported":
    if provider == "claude":
        request["request"]["subtype"] = "unknown_permission_method"
    else:
        request["method"] = "unknown/permission_method"
elif mode == "schema":
    assert provider == "codex"
    request["params"]["request"]["requestedSchema"] = {
        "type": "object", "properties": {"password": {"type": "string"}}}

def concurrent_request(index):
    value = json.loads(json.dumps(request))
    identity = 481 + index if id_kind == "number" else "opaque:permission/%s" % (481 + index)
    inputs = {"path": "local-fixture-%s" % index, "nested": {"raw": True, "ordinal": index}}
    if provider == "claude":
        value["request_id"] = identity
        value["request"]["input"] = inputs
    elif provider == "codex":
        value["id"] = identity
        value["params"]["request"]["_meta"]["tool_params"] = inputs
    else:
        value["id"] = identity
        value["params"]["toolCall"]["toolCallId"] = "call-%s" % index
        value["params"]["toolCall"]["rawInput"] = inputs
        value["params"]["options"] = [
            {"optionId": "opaque-yes/%s" % index, "kind": "allow_once", "name": "Once"},
            {"optionId": "opaque-no/%s" % index, "kind": "reject_once", "name": "No"}]
    return value, identity, inputs


def verify_concurrent_reply(index, approved):
    _, identity, inputs = concurrent_request(index)
    reply = receive()
    if provider == "claude":
        assert reply["type"] == "control_response"
        assert reply["response"]["request_id"] == identity
        result = reply["response"]["response"]
        assert result["behavior"] == ("allow" if approved else "deny")
        assert "updatedPermissions" not in result
        if approved:
            assert result["updatedInput"] == inputs
    elif provider == "codex":
        assert reply["id"] == identity
        assert reply["result"] == {"action": "accept" if approved else "decline", "content": {}}
    else:
        assert reply == {"jsonrpc": "2.0", "id": identity, "result": {"outcome": {
            "outcome": "selected", "optionId": "opaque-%s/%s" % ("yes" if approved else "no", index)}}}
    record({"verified_concurrent_reply": index, "wire_id": identity, "input": inputs, "approved": approved})
    if approved:
        with (root / "tool-marker").open("a") as stream:
            stream.write("executed-%s\n" % index)


if mode in ("queued_ui_cancel", "queued_session_delete", "queued_bad_publish",
            "queued_watchdog", "queued_parent_exit"):
    if mode == "queued_parent_exit":
        inherited_pipe_descendant()
    frames = [concurrent_request(index)[0] for index in range(3)]
    if mode == "queued_bad_publish":
        # Core accepts these strings. JobStore alone imposes metadata bounds.
        if provider == "claude":
            frames[1]["request"]["tool_name"] = "x" * 513
        elif provider == "codex":
            frames[1]["params"]["request"]["message"] = "x" * 4097
        else:
            frames[1]["params"]["toolCall"]["title"] = "x" * 4097
    sys.stdout.write("".join(json.dumps(frame) + "\n" for frame in frames))
    sys.stdout.flush()
    # Observing this update proves the runner handled every preceding request,
    # not merely that Python flushed bytes or its stdout reader buffered them.
    text("Queued requests buffered.")
    if mode == "queued_parent_exit":
        deadline = time.monotonic() + 5
        while not (root / "exit-release").exists():
            assert time.monotonic() < deadline, "runner did not observe queue marker"
            time.sleep(.002)
        record({"parent_exiting_queued": True})
        os._exit(17)
    if mode not in ("queued_watchdog",):
        verify_concurrent_reply(0, False)
        (root / "head-replied").write_text("denied\n")
    # Stay alive and record any fabricated reply to an unresolved request.
    unexpected = receive()
    raise AssertionError("unexpected unresolved queued reply: %r" % unexpected)

if mode in ("bulk", "bulk_reject_only"):
    for index in range(3):
        frame = concurrent_request(index)[0]
        if mode == "bulk_reject_only" and index == 1:
            assert provider == "copilot"
            frame["params"]["options"] = [frame["params"]["options"][1]]
        send(frame)
    for index in range(3):
        verify_concurrent_reply(index, not (mode == "bulk_reject_only" and index == 1))
    # This request did not exist when the user granted response-local consent.
    send(concurrent_request(3)[0])
    verify_concurrent_reply(3, True)
    answer = "Bulk permissions complete."
    text(answer, final=True)
    if provider == "claude":
        send({"type": "result", "subtype": "success", "is_error": False, "result": answer})
    elif provider == "codex":
        send({"method": "turn/completed", "params": {"threadId": "thread-1", "turn": {
            "id": "turn-1", "status": "completed"}}})
    else:
        rpc_result(prompt, {"stopReason": "end_turn"})
    time.sleep(30)
    sys.exit(9)

if mode in ("concurrent_fifo", "queued_cancel", "queued_overflow"):
    if mode == "concurrent_fifo":
        # Each of the first two requests must resolve before the next is sent.
        for index in range(2):
            send(concurrent_request(index)[0])
            verify_concurrent_reply(index, True)
        # One flush publishes three distinct requests before reading any reply.
        frames = [concurrent_request(index)[0] for index in range(2, 5)]
    else:
        # 34 exceeds max32 whether the visible prompt counts toward the bound.
        count = 34 if mode == "queued_overflow" else 3
        frames = [concurrent_request(index)[0] for index in range(count)]
    if mode == "queued_cancel":
        if provider == "claude":
            frames.append({"type": "control_cancel_request", "request_id": concurrent_request(0)[1]})
        elif provider == "codex":
            frames.append({"method": "turn/completed", "params": {"threadId": "thread-1", "turn": {
                "id": "turn-1", "status": "interrupted"}}})
        else:
            frames.append({"method": "session/cancel", "params": {"sessionId": "session-1"}})
    sys.stdout.write("".join(json.dumps(frame) + "\n" for frame in frames))
    sys.stdout.flush()
    if mode != "concurrent_fifo":
        # Stay alive, waiting on stdin, so failure must come from cancellation
        # or overflow, not EOF. Record and reject any fabricated decision.
        unexpected = receive()
        raise AssertionError("unexpected queued permission reply: %r" % unexpected)
    for index, approved in [(2, False), (3, True), (4, False)]:
        verify_concurrent_reply(index, approved)
    answer = "Concurrent permissions complete."
    text(answer, final=True)
    if provider == "claude":
        send({"type": "result", "subtype": "success", "is_error": False, "result": answer})
    elif provider == "codex":
        send({"method": "turn/completed", "params": {"threadId": "thread-1", "turn": {
            "id": "turn-1", "status": "completed"}}})
    else:
        rpc_result(prompt, {"stopReason": "end_turn"})
    record({"complete_sent": True})
    time.sleep(30)
    sys.exit(9)

if mode == "cancel":
    # A descendant holding the pipe open will write a marker if group kill is
    # missing, even when the direct peer was killed correctly.
    code = "import time,pathlib;time.sleep(1);pathlib.Path(%r).write_text('escaped')" % str(root / "descendant-marker")
    child = subprocess.Popen([sys.executable, "-c", code])
    record({"descendant_pid": child.pid})

if mode in ("parent_exit_pending", "parent_exit_complete"):
    inherited_pipe_descendant()

if provider != "copilot":
    text("Checking connector.")
else:
    send({"method": "session/update", "params": {"sessionId": "session-1", "update": {
        "sessionUpdate": "tool_call", "toolCallId": "call-1", "title": "Checking connector.", "status": "pending"}}})
permission_sent = time.monotonic()
send(request)
if mode == "parent_exit_pending":
    # Allow publication to reach the observer, then exit without closing the
    # inherited pipes. A driver watching only EOF waits for its long watchdog.
    time.sleep(.08)
    record({"parent_exiting_pending": True})
    os._exit(17)
busy_thread = None
if mode == "busy_peer":
    busy_thread = threading.Thread(target=busy_progress)
    busy_thread.start()
if mode in ("pending_duplicate", "pending_cancel"):
    if mode == "pending_duplicate":
        send(request)
    elif provider == "claude":
        send({"type": "control_cancel_request", "request_id": wire_id})
    elif provider == "codex":
        send({"method": "turn/completed", "params": {"threadId": "thread-1", "turn": {"id": "turn-1", "status": "interrupted"}}})
    else:
        send({"method": "session/cancel", "params": {"sessionId": "session-1"}})
    # Do not exit or accept a fabricated reply. The driver must keep reading
    # while the UI is still undecided, revoke the request, and kill this peer.
    time.sleep(30)
    sys.exit(9)
reply = receive()
if provider == "claude":
    assert reply["response"]["request_id"] == wire_id
    result = reply["response"]["response"]
    approved = result["behavior"] == "allow"
    assert result["behavior"] in ("allow", "deny")
    assert "updatedPermissions" not in result
    if approved:
        assert result["updatedInput"] == original
elif provider == "codex":
    assert reply["id"] == wire_id
    approved = reply["result"]["action"] == "accept"
    assert reply["result"] == {"action": "accept" if approved else "decline", "content": {}}
else:
    assert reply["id"] == wire_id
    outcome = reply["result"]["outcome"]
    if mode == "allow_only_deny":
        assert reply == {"jsonrpc": "2.0", "id": wire_id, "result": {
            "outcome": {"outcome": "cancelled"}}}
        approved = False
    else:
        approved = outcome["optionId"] == "opaque-yes/481"
        assert outcome == {"outcome": "selected", "optionId": "opaque-yes/481" if approved else "opaque-no/481"}
        if mode == "reject_only_deny":
            assert approved is False
record({"verified_reply": True, "approved": approved})
if approved:
    with (root / "tool-marker").open("a") as stream:
        stream.write("executed\n")
if busy_thread is not None:
    record({"tool_marker_seconds": time.monotonic() - permission_sent})
    busy_thread.join()
answer = "Connected." if approved else "Permission denied."
# Copilot ACP message chunks append within a turn. No claim that ACP supplies
# replacement semantics is made here; the core owns provider normalization.
if provider != "copilot":
    text(answer, final=True)
else:
    text(answer)
if provider == "claude":
    send({"type": "result", "subtype": "success", "is_error": False, "result": answer})
elif provider == "codex":
    send({"method": "turn/completed", "params": {"threadId": "thread-1", "turn": {"id": "turn-1", "status": "completed"}}})
else:
    rpc_result(prompt, {"stopReason": "end_turn"})
record({"complete_sent": True})
if mode == "parent_exit_complete":
    record({"parent_exiting_complete": True})
    os._exit(0)
# App servers are long-lived. Protocol completion, not exit status, must return
# success; the driver must then clean up this peer and all its descendants.
time.sleep(30)
