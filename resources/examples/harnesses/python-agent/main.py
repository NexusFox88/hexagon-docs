"""Example user-owned Harness. All code and model calls run inside the Sandbox."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError


def post(url, payload, headers, timeout=60):
    request = Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", **headers}, method="POST")
    with urlopen(request, timeout=timeout) as response:
        return json.load(response)


def main():
    task = json.load(sys.stdin)
    if task["protocol"] != "hexagon-json-v1":
        raise ValueError("unsupported protocol")
    native = str(uuid.UUID(task.get("native_session") or task["run_id"]))
    history_path = Path(__file__).parent / f"session-{native}.json"
    messages = json.loads(history_path.read_text()) if history_path.exists() else []
    initialization = task.get('initialization') or {}
    if initialization.get('context') and not messages:
        messages.append({'role':'user','content':initialization['context']})
    messages.append({"role": "user", "content": task["input"]})
    tools = [{"name": "shell", "description": "Execute a shell command inside the workspace. For servers use nohup with stdout/stderr redirected and & to keep running. Use commands to read/write files and run tests.", "input_schema": {"type": "object", "properties": {"command": {"type": "string"}}, "required": ["command"], "additionalProperties": False}}]
    remote = {tool["name"]: tool for tool in task["tools"]}
    tools.extend({"name": tool["name"], "description": tool["description"], "input_schema": tool["inputSchema"]} for tool in remote.values())
    endpoint = task["model"]["base_url"].rstrip("/")
    if not endpoint.endswith("/v1"):
        endpoint += "/v1"
    artifact_directory = (Path.cwd() / task["artifact_directory"]).resolve()
    artifact_directory.relative_to(Path.cwd().resolve())
    artifact_directory.mkdir(parents=True, exist_ok=True)
    system = ("You are a coding agent in a cloud sandbox. Complete the user's task using tools and verify results. "
              "Available remote tools are equivalent to the user's requested MCP tools. "
              "All requested downloadable deliverables, including test reports and modified files, must be copied into the exact absolute directory " + json.dumps(str(artifact_directory)) + ". Files elsewhere in the workspace are not exported. "
              "Before your final answer, use the shell to list that directory and verify every requested deliverable is present and contains the expected output. "
              "Never export credentials. Keep preview servers alive after completing the task. "
              "Tool authorization/approval waits are handled by the platform: wait for the tool result. "
              "Reply in Chinese with factual results after completing all requested work.")
    if initialization.get('system'):
        system += '\n\n' + initialization['system']
    for _ in range(50):
        response = post(endpoint + "/messages", {"model": task["model"]["model"], "max_tokens": 8192, "system": system, "messages": messages, "tools": tools},
                        {"x-api-key": os.environ["HEXAGON_MODEL_KEY"], "anthropic-version": "2023-06-01"})
        blocks = response["content"]
        messages.append({"role": "assistant", "content": blocks})
        calls = [part for part in blocks if part["type"] == "tool_use"]
        if not calls:
            text = "\n".join(part["text"] for part in blocks if part["type"] == "text")
            if response.get("stop_reason") != "end_turn" or not text:
                raise RuntimeError("model_did_not_complete")
            temporary = history_path.with_suffix(".tmp")
            temporary.write_text(json.dumps(messages))
            temporary.replace(history_path)
            print(json.dumps({"type": "hexagon.result", "text": text, "native_session": native, "failed": False}), flush=True)
            return
        results = []
        for call in calls:
            if call["name"] == "shell":
                try:
                    result = subprocess.run(call["input"]["command"], shell=True, capture_output=True, text=True, timeout=120)
                    output = {"exit_code": result.returncode, "stdout": result.stdout[-48000:], "stderr": result.stderr[-12000:]}
                except subprocess.TimeoutExpired:
                    output = {"error": "command_timeout"}
            elif call["name"] in remote:
                payload = {"id": str(uuid.uuid4()), "name": call["name"], "arguments": call["input"]}
                while True:
                    try:
                        row = post(f"http://127.0.0.1:8765/tools/{task['run_id']}/call", payload, {"Authorization": "Bearer " + os.environ["HEXAGON_TOOL_TOKEN"]}, timeout=15)
                    except HTTPError:
                        raise RuntimeError("mailbox_rejected") from None
                    except (URLError, TimeoutError):
                        time.sleep(0.5)
                        continue  # Retry the same immutable call, never create a new operation.
                    if row["state"] == "completed":
                        output = row["result"]
                        break
                    time.sleep(0.5)
            else:
                output = {"error": "unknown_tool"}
            results.append({"type": "tool_result", "tool_use_id": call["id"], "content": json.dumps(output)})
        messages.append({"role": "user", "content": results})
    raise RuntimeError("step_limit_exceeded")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # HTTP errors can contain sensitive diagnostics; keep the public result bounded.
        print(json.dumps({"type": "hexagon.result", "text": "Custom Harness execution failed.", "failed": True, "error_type": type(error).__name__, "http_status": getattr(error, "code", None) if isinstance(getattr(error, "code", None), int) else None}), flush=True)
        sys.exit(1)
