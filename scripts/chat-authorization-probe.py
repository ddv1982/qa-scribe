"""Opt-in, credential-isolated CLI failure-state compatibility observations.

This invokes installed CLIs, never logs out or changes their normal settings,
and makes no model request. It does not prove candidate-app tool execution.
"""

import json
import os
import queue
import subprocess
import tempfile
import threading


def run(command, cwd, env):
    result = subprocess.run(
        command, cwd=cwd, env=env, capture_output=True, text=True, timeout=30
    )
    return result.returncode, (result.stdout + result.stderr).strip()


with tempfile.TemporaryDirectory(prefix="qa-scribe-auth-state-") as scope:
    # Inherit executable discovery, not account tokens or configuration paths.
    env = {
        "PATH": os.environ["PATH"],
        "HOME": scope,
        "XDG_CONFIG_HOME": scope,
        "GH_CONFIG_DIR": scope,
        "CLAUDE_CONFIG_DIR": scope,
        "CODEX_HOME": scope,
        "COPILOT_HOME": scope,
        "COPILOT_AUTO_UPDATE": "false",
        "CI": "true",
    }
    code, text = run(["claude", "auth", "status", "--json"], scope, env)
    status = json.loads(text)
    assert status.get("loggedIn") is False, "Expected isolated Claude auth-required"
    print(json.dumps({"provider": "claude", "category": "authenticationRequired", "loggedIn": False, "exitCode": code}))

    # The installed Vite+ executable shim resolves its target through HOME.
    # Keep executable discovery intact while CODEX_HOME isolates Codex auth.
    codex_env = dict(env, HOME=os.environ["HOME"])
    code, text = run(["codex", "login", "status"], scope, codex_env)
    assert code != 0 and "not logged in" in text.lower(), f"Expected isolated Codex auth-required: exit={code}, response={text}"
    print(json.dumps({"provider": "codex", "category": "authenticationRequired", "exitCode": code, "message": text}))

    # This observes configuration absence, not a remote connector's OAuth state.
    for provider in ("claude", "codex", "copilot"):
        code, text = run([provider, "mcp", "get", "qa_scribe_missing"], scope, codex_env if provider == "codex" else env)
        assert code != 0, f"{provider} accepted a nonexistent MCP server"
        assert any(word in text.lower() for word in ("not found", "no mcp", "does not exist", "not configured")), text
        print(json.dumps({"provider": provider, "category": "connectorNotConfigured", "exitCode": code, "message": text}))

    for provider, command in (("codex", ["codex", "app-server"]), ("copilot", ["copilot", "--acp"])):
        process = subprocess.Popen(command, cwd=scope, env=codex_env if provider == "codex" else env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        incoming = queue.Queue()
        def collect(stream, target):
            for line in stream:
                try:
                    target.put(json.loads(line))
                except ValueError:
                    continue
        threading.Thread(target=collect, args=(process.stdout, incoming), daemon=True).start()
        def send(message):
            process.stdin.write(json.dumps(message) + "\n")
            process.stdin.flush()
        error = None
        try:
            send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": 1, "clientCapabilities": {}, "clientInfo": {"name": "qa_scribe_probe", "version": "0.8.1"}}})
            while True:
                message = incoming.get(timeout=30)
                if message.get("id") == 1:
                    assert "result" in message, message
                    if provider == "codex":
                        send({"method": "initialized"})
                    send({"jsonrpc": "2.0", "id": 2, "method": "qa_scribe_unsupported", "params": {}})
                if message.get("id") == 2:
                    error = message.get("error")
                    break
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        assert error is not None and error.get("code") in (-32600, -32601), f"{provider} did not reject unsupported protocol: {error}"
        print(json.dumps({"provider": provider, "category": "unsupportedProtocol", "code": error["code"], "message": error["message"]}))

    # Representative ACP wire shapes from the official protocol contract.
    permission = {"id": 5, "method": "session/request_permission", "params": {"sessionId": "fixture", "toolCall": {"toolCallId": "call-1"}, "options": [{"optionId": "opaque-a", "kind": "allow_once"}, {"optionId": "opaque-d", "kind": "reject_once"}]}}
    for kind in ("allow_once", "reject_once"):
        option = next(option for option in permission["params"]["options"] if option["kind"] == kind)
        response = {"id": permission["id"], "result": {"outcome": {"outcome": "selected", "optionId": option["optionId"]}}}
        assert response["result"]["outcome"]["optionId"] != kind
    print("PASS: isolated authentication, discovery and unsupported-protocol observations; representative ACP shape check is deterministic, not live Copilot permission proof.")
