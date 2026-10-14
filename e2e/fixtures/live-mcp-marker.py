"""Ephemeral, stdio MCP marker server. No filesystem/network tools are exposed."""
import json
import os
import sys


def handle(request):
    method = request.get("method")
    if method == "initialize":
        return {"protocolVersion": request.get("params", {}).get("protocolVersion", "2024-11-05"),
                "capabilities": {"tools": {}}, "serverInfo": {"name": "qa_scribe_probe", "version": "1.0.0"}}
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": [{"name": "read_marker", "description": "Read the harmless local authorization test nonce once.",
                           "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
                           "annotations": {"readOnlyHint": True, "destructiveHint": False, "openWorldHint": False}}]}
    if method == "tools/call":
        params = request.get("params", {})
        name = params.get("name")
        arguments = params.get("arguments", {})
        nonce = ""
        if name == "read_marker" and arguments == {}:
            with open(os.environ["QA_SCRIBE_LIVE_MARKER"], encoding="utf-8") as marker:
                nonce = marker.read().strip()
        # Journal every attempted call, including unknown names or invalid arguments.
        with open(os.environ["QA_SCRIBE_LIVE_JOURNAL"], "a", encoding="utf-8") as journal:
            journal.write(json.dumps({"tool": name, "arguments": arguments, "nonce": nonce}) + "\n")
            journal.flush()
            os.fsync(journal.fileno())
        return {"content": [{"type": "text", "text": nonce or "Invalid marker tool call"}], "isError": not bool(nonce)}
    return None


for line in sys.stdin:
    try:
        request = json.loads(line)
        if "id" not in request:
            continue
        result = handle(request)
        response = {"jsonrpc": "2.0", "id": request["id"]}
        if result is None:
            response["error"] = {"code": -32601, "message": "Method not found"}
        else:
            response["result"] = result
        print(json.dumps(response), flush=True)
    except (ValueError, KeyError, OSError):
        # Never emit environment, credential paths, or raw account data.
        sys.exit(1)
