"""Sandbox-local harness supervisor. No provider account credentials are needed here.

Launch with HEXAGON_RUNTIME_TOKEN, HEXAGON_RUNTIME_HOME and optional PORT.
The control plane supplies a pinned harness command and model environment per Run.
This protocol is internal, authenticated, and never exposed as an unauthenticated API.
"""
import hashlib
import base64
import hmac
import json
import os
import socket
import signal
import stat
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs


class Runtime:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir(exist_ok=True)
        self.lock = threading.RLock()
        self.processes = {}
        self.cancellations = {}
        self.quarantined = False
        # A new supervisor cannot safely replay an interrupted harness invocation.
        for path in self.root.glob("runs/*/state.json"):
            row = json.loads(path.read_text())
            if row["state"] in ("starting", "running", "cancelling", "interrupted"):
                self.quarantined = True
                row["state"] = "interrupted"
                self.save(row)
                self.event(row["id"], "runtime.interrupted", {"reason": "supervisor_restarted"})

    def directory(self, run_id):
        if not isinstance(run_id, str) or not run_id or len(run_id) > 128 or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in run_id):
            raise ValueError("invalid_run_id")
        return self.root / "runs" / run_id

    def save(self, row):
        path = self.directory(row["id"]) / "state.json"
        temp = path.with_suffix(".tmp")
        with temp.open("w") as handle:
            json.dump(row, handle)
            handle.flush()
            os.fsync(handle.fileno())
        temp.replace(path)

    def state(self, run_id):
        with self.lock:
            return json.loads((self.directory(run_id) / "state.json").read_text())

    def inputs(self, body):
        files = body["files"]
        decoded = []
        for item in files:
            path = item["path"]
            if not isinstance(path, str) or path.startswith("/") or "\\" in path or any(p in ("", ".", "..") for p in path.split("/")):
                raise ValueError("invalid_input_path")
            decoded.append((path, base64.b64decode(item["content_base64"], validate=True)))
        with self.lock:
            if self.quarantined or any((self.root / "runs").glob("*/state.json")):
                raise ValueError("workspace_already_started")
            for path, data in decoded:
                target = self.workspace / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
            return {"files": [{"path": path, "sha256": hashlib.sha256((self.workspace / path).read_bytes()).hexdigest()} for path, _ in decoded]}

    def event(self, run_id, kind, data):
        with self.lock:
            path = self.directory(run_id) / "events.jsonl"
            # The event stream is append-only; the offset itself is the durable cursor.
            offset = path.stat().st_size if path.exists() else 0
            row = {"type": kind, "data": data, "time": time.time()}
            line = (json.dumps(row, ensure_ascii=False) + "\n").encode()
            with path.open("ab") as handle:
                handle.write(line)
                handle.flush()
                os.fsync(handle.fileno())
            return offset + len(line)

    def events(self, run_id, after):
        with self.lock:
            self.state(run_id)
            path = self.directory(run_id) / "events.jsonl"
            if not path.exists():
                return {"events": [], "cursor": 0}
            with path.open("rb") as handle:
                size = path.stat().st_size
                if after < 0 or after > size:
                    raise ValueError("invalid_cursor")
                if after:
                    handle.seek(after - 1)
                    if handle.read(1) != b"\n":
                        raise ValueError("invalid_cursor")
                handle.seek(after)
                rows = []
                for _ in range(250):
                    line = handle.readline()
                    if not line:
                        break
                    row = json.loads(line)
                    row["cursor"] = handle.tell()
                    rows.append(row)
                return {"events": rows, "cursor": handle.tell()}

    def artifacts(self, run_id):
        with self.lock:
            if self.state(run_id)["state"] not in ("exited", "cancelled", "failed"):
                raise ValueError("harness_not_finished")
            snapshot = self.directory(run_id) / "artifacts.json"
            if snapshot.exists():
                return json.loads(snapshot.read_text())
            files = []
            total = 0
            def walk(fd, prefix="", depth=0):
                nonlocal total
                if depth > 8:
                    raise ValueError("artifact_depth_exceeded")
                for name in sorted(os.listdir(fd)):
                    if any(ord(c) < 32 for c in name) or "\\" in name:
                        raise ValueError("invalid_artifact_name")
                    child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
                    try:
                        info = os.fstat(child)
                        relative = prefix + name
                        if len(relative) > 512:
                            raise ValueError("invalid_artifact_name")
                        if stat.S_ISDIR(info.st_mode):
                            walk(child, relative + "/", depth + 1)
                        elif stat.S_ISREG(info.st_mode):
                            if len(files) >= 64 or info.st_size > 4 * 1024 * 1024:
                                raise ValueError("artifact_limit_exceeded")
                            with os.fdopen(os.dup(child), "rb") as stream:
                                data = stream.read(4 * 1024 * 1024 + 1)
                            total += len(data)
                            if len(data) > 4 * 1024 * 1024 or total > 8 * 1024 * 1024:
                                raise ValueError("artifact_limit_exceeded")
                            files.append({"name": relative, "content_base64": base64.b64encode(data).decode(), "sha256": hashlib.sha256(data).hexdigest()})
                        else:
                            raise ValueError("artifact_not_regular_file")
                    finally:
                        os.close(child)
            descriptors = []
            try:
                fd = os.open(self.workspace, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                descriptors.append(fd)
                try:
                    for component in ("artifacts", run_id):
                        fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                        descriptors.append(fd)
                except FileNotFoundError:
                    fd = None
                if fd is not None:
                    walk(fd)
            except OSError as error:
                raise ValueError("artifact_path_rejected") from error
            finally:
                for fd in reversed(descriptors):
                    os.close(fd)
            result = {"files": files}
            self.save_tool(snapshot, result)
            return result

    def tool_auth(self, run_id, supplied):
        with self.lock:
            path = self.directory(run_id) / "tools.json"
            if not path.exists():
                return False
            expected = json.loads(path.read_text())["token"]
            return hmac.compare_digest(supplied, f"Bearer {expected}")

    def tool_call(self, run_id, body):
        with self.lock:
            row = self.state(run_id)
            if row["state"] != "running":
                raise ValueError("run_not_active")
            call_id = str(uuid.UUID(body["id"]))
            manifest = json.loads((self.directory(run_id) / "tools.json").read_text())
            tool = next((item for item in manifest["definitions"] if item["name"] == body["name"]), None)
            if tool is None or not isinstance(body.get("arguments", {}), dict):
                raise ValueError("invalid_tool")
            call = {"id": call_id, "binding": tool["binding"], "operation": tool["operation"], "arguments": body.get("arguments", {})}
            path = self.directory(run_id) / "calls" / (call_id + ".json")
            if path.exists():
                existing = json.loads(path.read_text())
                if existing["call"] != call:
                    raise ValueError("tool_call_conflict")
                return existing
            result = {"call": call, "state": "pending"}
            self.save_tool(path, result)
            return result

    @staticmethod
    def save_tool(path, value):
        path.parent.mkdir(exist_ok=True, mode=0o700)
        temp = path.with_suffix(".tmp")
        with temp.open("w") as handle:
            json.dump(value, handle)
            handle.flush()
            os.fsync(handle.fileno())
        temp.replace(path)

    def pending_tools(self, run_id):
        with self.lock:
            # Persisted mailboxes survive a supervisor restart, but their former
            # harness no longer owns an active invocation. Keep them for audit,
            # never offer their side effects for dispatch after interruption.
            if self.state(run_id)["state"] != "running":
                return {"calls": []}
            rows = [json.loads(path.read_text()) for path in sorted((self.directory(run_id) / "calls").glob("*.json"))]
            return {"calls": [row["call"] for row in rows if row["state"] == "pending"]}

    def tool_result(self, run_id, body):
        with self.lock:
            call_id = str(uuid.UUID(body["id"]))
            path = self.directory(run_id) / "calls" / (call_id + ".json")
            row = json.loads(path.read_text())
            if row["state"] == "completed" and row["result"] != body["result"]:
                raise ValueError("tool_result_conflict")
            row.update(state="completed", result=body["result"])
            self.save_tool(path, row)
            return {"state": "completed"}

    def start(self, body):
        run_id = body["id"]
        command = body["command"]
        env = body.get("env", {})
        input_text = body.get("stdin", "")
        if not isinstance(input_text, str) or len(input_text.encode()) > 65536:
            raise ValueError("invalid_stdin")
        if not isinstance(command, list) or not command or any(not isinstance(arg, str) for arg in command):
            raise ValueError("invalid_command")
        if not isinstance(env, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in env.items()):
            raise ValueError("invalid_environment")
        tools = body.get("tools")
        if tools is not None:
            if not isinstance(tools.get("token"), str) or len(tools["token"]) < 32 or not isinstance(tools.get("definitions"), list):
                raise ValueError("invalid_tools")
        digest = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
        with self.lock:
            path = self.directory(run_id)
            if path.exists():
                state = self.state(run_id)
                if state["request_hash"] != digest:
                    raise ValueError("idempotency_conflict")
                return state
            if self.quarantined:
                raise ValueError("workspace_requires_recovery")
            if self.processes:
                raise ValueError("workspace_busy")
            path.mkdir(parents=True, mode=0o700)
            row = {"id": run_id, "state": "starting", "request_hash": digest}
            self.save(row)
            if tools is not None:
                self.save_tool(path / "tools.json", tools)
            self.event(run_id, "harness.starting", {})
            # Do not let the child inherit the runtime management credential.
            child_env = {k: v for k, v in os.environ.items() if k != "HEXAGON_RUNTIME_TOKEN"}
            child_env.update(env)
            child_env.pop("HEXAGON_RUNTIME_TOKEN", None)
            try:
                process = subprocess.Popen(command, cwd=self.workspace, env=child_env, stdin=subprocess.PIPE,
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            except OSError:
                row["state"] = "failed"
                row["error"] = "harness_start_failed"
                self.save(row)
                self.event(run_id, "harness.failed", {"code": "harness_start_failed"})
                return row
            self.processes[run_id] = process
            threading.Thread(target=self.send_input, args=(process, input_text), daemon=True).start()
            row.update(state="running", pid=process.pid)
            self.save(row)
            self.event(run_id, "harness.running", {"pid": process.pid})
            threading.Thread(target=self.collect, args=(run_id, process, list(env.values())), daemon=True).start()
            return row

    @staticmethod
    def send_input(process, text):
        try:
            process.stdin.write(text.encode())
            process.stdin.flush()
        except (BrokenPipeError, OSError):
            pass
        finally:
            process.stdin.close()

    def collect(self, run_id, process, sensitive):
        def read(stream, name):
            while True:
                chunk = stream.readline(65536)
                if not chunk:
                    return
                text = chunk.decode(errors="replace")
                for value in sensitive:
                    if len(value) >= 8:
                        text = text.replace(value, "[REDACTED]")
                self.event(run_id, f"harness.{name}", {"text": text})
        readers = [threading.Thread(target=read, args=(process.stdout, "stdout")), threading.Thread(target=read, args=(process.stderr, "stderr"))]
        for thread in readers:
            thread.start()
        code = process.wait()
        for thread in readers:
            thread.join()
        process.stdout.close()
        process.stderr.close()
        cancellation = self.cancellations.get(run_id)
        if cancellation:
            cancellation.wait()
        with self.lock:
            row = self.state(run_id)
            row.update(state="cancelled" if row["state"] == "cancelling" else "exited", exit_code=code)
            self.save(row)
            self.event(run_id, "harness.exited", {"exit_code": code, "state": row["state"]})
            self.processes.pop(run_id, None)

    def cancel(self, run_id):
        with self.lock:
            row = self.state(run_id)
            process = self.processes.get(run_id)
            if process is None:
                return row
            if run_id in self.cancellations:
                return row
            descendants = self.descendants(process.pid)
            settled = threading.Event()
            self.cancellations[run_id] = settled
            row["state"] = "cancelling"
            self.save(row)
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            for pid, identity in descendants.items():
                self.signal_descendant(pid, identity, signal.SIGTERM)
            threading.Thread(target=self.force_stop, args=(process, descendants, settled), daemon=True).start()
            return row

    @staticmethod
    def process_identity(pid):
        # Linux cloud Runtime: start time fences PID reuse. Zombies have stopped.
        try:
            fields = (Path("/proc") / str(pid) / "stat").read_text().rsplit(")", 1)[1].split()
            return None if fields[0] == "Z" else (int(fields[1]), fields[19])
        except (FileNotFoundError, ProcessLookupError):
            return None

    @classmethod
    def descendants(cls, root):
        processes = {}
        for path in Path("/proc").glob("[0-9]*"):
            identity = cls.process_identity(int(path.name))
            if identity:
                processes[int(path.name)] = identity
        selected = {root}
        while True:
            children = {pid for pid, (parent, _) in processes.items() if parent in selected}
            if children <= selected:
                break
            selected.update(children)
        return {pid: processes[pid][1] for pid in selected if pid != root and pid in processes}

    @classmethod
    def signal_descendant(cls, pid, identity, sig):
        current = cls.process_identity(pid)
        if current and current[1] == identity:
            try:
                os.kill(pid, sig)
            except ProcessLookupError:
                pass

    @classmethod
    def force_stop(cls, process, descendants, settled):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            live = {pid: identity for pid, identity in descendants.items()
                    if (current := cls.process_identity(pid)) and current[1] == identity}
            if process.poll() is not None and not live:
                settled.set()
                return
            time.sleep(0.05)
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        for pid, identity in descendants.items():
            cls.signal_descendant(pid, identity, signal.SIGKILL)
        # Do not publish a false terminal state if a process cannot be stopped.
        while process.poll() is None or any(
                (current := cls.process_identity(pid)) and current[1] == identity
                for pid, identity in descendants.items()):
            time.sleep(0.05)
        settled.set()


def serve(runtime, token, port):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            self.dispatch()

        def do_POST(self):
            self.dispatch()

        def dispatch(self):
            parsed = urlparse(self.path)
            parts = parsed.path.strip("/").split("/")
            try:
                tool_route = len(parts) == 3 and parts[0] == "tools" and parts[2] == "call" and self.command == "POST"
                authenticated = runtime.tool_auth(parts[1], self.headers.get("Authorization", "")) if tool_route else hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {token}")
                if not authenticated:
                    return self.respond(401, {"error": "unauthorized"})
                if tool_route:
                    return self.respond(200, runtime.tool_call(parts[1], self.body()))
                if self.command == "GET" and parts in (["health"], ["_hexagon", "health"]):
                    return self.respond(200, {"state": "ready", "protocol": 1})
                if self.command == "POST" and parts == ["runs"]:
                    size = int(self.headers.get("Content-Length", "0"))
                    if size < 1 or size > 1048576:
                        raise ValueError("invalid_body_size")
                    return self.respond(202, runtime.start(json.loads(self.rfile.read(size))))
                if self.command == "POST" and parts == ["inputs"]:
                    size = int(self.headers.get("Content-Length", "0"))
                    if size < 1 or size > 12582912:
                        raise ValueError("invalid_body_size")
                    return self.respond(200, runtime.inputs(json.loads(self.rfile.read(size))))
                if len(parts) >= 2 and parts[0] == "runs":
                    run_id = parts[1]
                    if self.command == "GET" and parts[2:] == ["artifacts"]:
                        return self.respond(200, runtime.artifacts(run_id))
                    if self.command == "GET" and parts[2:] == ["tools"]:
                        return self.respond(200, runtime.pending_tools(run_id))
                    if self.command == "POST" and parts[2:] == ["tool-results"]:
                        return self.respond(200, runtime.tool_result(run_id, self.body()))
                    if self.command == "GET" and len(parts) == 2:
                        return self.respond(200, runtime.state(run_id))
                    if self.command == "GET" and parts[2:] == ["events"]:
                        cursor = int(parse_qs(parsed.query).get("after", ["0"])[0])
                        return self.respond(200, runtime.events(run_id, cursor))
                    if self.command == "POST" and parts[2:] == ["cancel"]:
                        return self.respond(200, runtime.cancel(run_id))
                self.respond(404, {"error": "not_found"})
            except FileNotFoundError:
                self.respond(404, {"error": "run_not_found"})
            except (ValueError, KeyError, TypeError):
                self.respond(409, {"error": "invalid_request_or_conflict"})
            except Exception:
                self.respond(500, {"error": "runtime_error"})

        def body(self):
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > 2097152:
                raise ValueError("invalid_body_size")
            return json.loads(self.rfile.read(size))

        def respond(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    # Cloud providers may route previews over IPv6. Accept both families where
    # supported, keeping IPv4-only environments usable.
    class DualStackServer(ThreadingHTTPServer):
        address_family = socket.AF_INET6

        def server_bind(self):
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
            super().server_bind()

    try:
        server = DualStackServer(("::", port), Handler)
    except OSError:
        server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    runtime_token = os.environ["HEXAGON_RUNTIME_TOKEN"]
    if len(runtime_token) < 32:
        raise RuntimeError("Runtime token must have at least 32 characters")
    serve(Runtime(os.environ.get("HEXAGON_RUNTIME_HOME", "/tmp/hexagon-runtime")), runtime_token, int(os.environ.get("PORT", "8765")))
