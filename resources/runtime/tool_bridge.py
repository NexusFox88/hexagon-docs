"""MCP stdio adapter. Only a Run-scoped mailbox token enters this process."""
import json
import os
import sys
import time
import uuid
import urllib.request
import urllib.error


def invoke(params):
    payload = json.dumps({"id": str(uuid.uuid4()), "name": params["name"], "arguments": params.get("arguments", {})}).encode()
    url = f"http://127.0.0.1:{os.environ.get('HEXAGON_RUNTIME_PORT', '8765')}/tools/{os.environ['HEXAGON_RUN_ID']}/call"
    while True:
        request = urllib.request.Request(url, data=payload, headers={"Authorization": f"Bearer {os.environ['HEXAGON_TOOL_TOKEN']}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                row = json.load(response)
        except urllib.error.HTTPError:
            return {"isError": True, "content": [{"type": "text", "text": "Tool call rejected or Run no longer active."}]}
        except (urllib.error.URLError, TimeoutError):
            # The immutable call ID makes retries safe, including a lost response.
            time.sleep(1)
            continue
        if row["state"] == "completed":
            return row["result"]
        time.sleep(0.5)


def dispatch(request):
    method = request.get("method")
    if method == "initialize":
        return {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "hexagon-tools", "version": "0.1.0"}}
    if method == "ping":
        return {}
    if method == "tools/list":
        definitions = json.loads(os.environ.get("HEXAGON_TOOLS", "[]"))
        return {"tools": [{key: value for key, value in item.items() if key in ("name", "description", "inputSchema")} for item in definitions]}
    if method == "tools/call":
        return invoke(request["params"])
    raise LookupError("Method not found")


def main():
    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            if "id" not in request:
                continue
            result = {"jsonrpc": "2.0", "id": request["id"], "result": dispatch(request)}
        except Exception as error:
            code = -32601 if isinstance(error, LookupError) else -32602
            result = {"jsonrpc": "2.0", "id": request.get("id") if isinstance(request, dict) else None, "error": {"code": code, "message": "Method not found" if code == -32601 else "Invalid request"}}
        print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
