"""Synchronous Hexagon API client with durable event cursor support."""
from .contracts import SessionPreflight
import base64
import json
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


class HexagonError(Exception):
    def __init__(self, status, code):
        self.status, self.code = status, code
        super().__init__(f"Hexagon request failed: {code} ({status})")


class Hexagon:
    @classmethod
    def local(cls, *, data_directory=None, base_url=None, timeout=90):
        from .local import local_identity
        base, token = local_identity(data_directory, base_url)
        client = cls(base, token, timeout)
        client._local = True
        return client

    def __init__(self, base_url, token, timeout=90):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout
        self._local = False

    def _open(self, method, path, body=None, headers=None):
        fields = {"Authorization": f"Bearer {self.token}"}
        if body is not None:
            fields["Content-Type"] = "application/json"
        fields.update(headers or {})
        request = Request(self.base_url + "/v1" + path, data=None if body is None else json.dumps(body).encode(), headers=fields, method=method)
        try:
            if self._local:
                from urllib.request import build_opener, HTTPRedirectHandler
                class NoRedirect(HTTPRedirectHandler):
                    def redirect_request(self, req, fp, code, msg, headers, newurl):
                        return None
                return build_opener(NoRedirect).open(request, timeout=self.timeout)
            return urlopen(request, timeout=self.timeout)
        except HTTPError as error:
            try:
                code = json.loads(error.read()).get("error", {}).get("code", "http_error")
            except (ValueError, AttributeError):
                code = "http_error"
            finally:
                error.close()
            raise HexagonError(error.code, code) from None

    def request(self, method, path, body=None, headers=None):
        with self._open(method, path, body, headers) as response:
            return None if response.status == 204 else json.load(response)

    def create_preview(self, session_id, port, ttl_seconds=600):
        return self.request("POST", f"/sessions/{quote(session_id, safe='')}/previews", {"port": port, "ttl_seconds": ttl_seconds})

    def revoke_preview(self, preview_id):
        return self.request("DELETE", f"/previews/{quote(preview_id, safe='')}")

    def register_harness(self, *, image, **configuration):
        """Register an OCI image; the server resolves and pins its manifest digest."""
        return self.request("POST", "/harnesses", {"image": image, **configuration})

    def register_harness_package(self, **package):
        """Legacy source package registration for existing pinned runtimes."""
        return self.request("POST", "/harness-packages", package)

    def catalog(self):
        return self.request("GET", "/catalog")

    def applications(self):
        return self.request("GET", "/applications")

    def configure_application_oauth(self, provider, **configuration):
        return self.request("PUT", f"/applications/{quote(provider, safe='')}/oauth-client", configuration)

    def authorize_connection(self, connection_id):
        return self.request("POST", f"/connections/{quote(connection_id, safe='')}/authorize")

    def authorization_flow(self, flow_id):
        return self.request("GET", f"/authorization-flows/{quote(flow_id, safe='')}")

    def cancel_authorization(self, flow_id):
        return self.request("DELETE", f"/authorization-flows/{quote(flow_id, safe='')}")

    def create_secret(self, *, name, value):
        return self.request("POST", "/secrets", {"name": name, "value": value})

    def session_environment(self, session_id):
        return self.request("GET", f"/sessions/{quote(session_id, safe='')}/environment")

    def session_authorization(self, session_id):
        return self.request("GET", f"/sessions/{quote(session_id, safe='')}/authorization")

    def revoke_session_connection(self, session_id, connection_id):
        return self.request("DELETE", f"/sessions/{quote(session_id, safe='')}/connections/{quote(connection_id, safe='')}")

    def list_secrets(self):
        return self.request("GET", "/secrets")

    def secret(self, secret_id):
        return self.request("GET", f"/secrets/{quote(secret_id, safe='')}")

    def update_secret(self, secret_id, **changes):
        return self.request("PATCH", f"/secrets/{quote(secret_id, safe='')}", changes)

    def delete_secret(self, secret_id):
        return self.request("DELETE", f"/secrets/{quote(secret_id, safe='')}")

    def create_access(self, session, connection_id):
        return self.request("POST", f"/sessions/{quote(session, safe='')}/access", {"connection_id": connection_id})

    def list_access(self, session):
        return self.request("GET", f"/sessions/{quote(session, safe='')}/access")

    def revoke_access(self, grant_id):
        return self.request("DELETE", f"/access/{quote(grant_id, safe='')}")

    def overview(self):
        return self.request("GET", "/overview")

    def list_sessions(self, **query):
        return self.request("GET", "/sessions?" + urlencode(query))

    def list_runs(self, **query):
        return self.request("GET", "/runs?" + urlencode(query))

    def pending(self, limit=25, offset=0):
        return self.request("GET", f"/pending?limit={limit}&offset={offset}")

    def approvals(self, run_id):
        return self.request("GET", f"/runs/{quote(run_id, safe='')}/approvals")

    def connection_dependencies(self, connection_id):
        return self.request("GET", f"/connections/{quote(connection_id, safe='')}/dependencies")

    def list_tokens(self):
        return self.request("GET", "/tokens")

    def create_token(self, label, expires_in_days=30):
        return self.request("POST", "/tokens", {"label": label, "expires_in_days": expires_in_days})

    def rotate_token(self, token_id):
        return self.request("POST", f"/tokens/{quote(token_id, safe='')}/rotate")

    def revoke_token(self, token_id):
        return self.request("DELETE", f"/tokens/{quote(token_id, safe='')}")

    def deployment(self):
        return self.request("GET", "/deployment")

    def update_deployment(self, config, expected_revision):
        return self.request("PUT", "/deployment", {"config": config, "expected_revision": expected_revision})

    def retry_ingress(self):
        return self.request("POST", "/deployment/ingress/retry")

    def resource_operations(self, limit=50, offset=0):
        return self.request("GET", f"/resource-operations?limit={limit}&offset={offset}")

    def resource_operation(self, operation_id):
        return self.request("GET", f"/resource-operations/{quote(operation_id, safe='')}")

    def review_resource_operation(self, operation_id, action, note=""):
        return self.request("POST", f"/resource-operations/{quote(operation_id, safe='')}/review", {"action": action, "note": note})

    def list_agents(self):
        return self.request("GET", "/agents")

    def agent(self, agent_id):
        return self.request("GET", f"/agents/{quote(agent_id, safe='')}")

    def revise_agent(self, agent_id, definition, expected_revision):
        return self.request("PUT", f"/agents/{quote(agent_id, safe='')}", {"definition": definition, "expected_revision": expected_revision})

    def archive_agent(self, agent_id):
        return self.request("POST", f"/agents/{quote(agent_id, safe='')}/archive")

    def copy_agent(self, agent_id, name):
        return self.request("POST", f"/agents/{quote(agent_id, safe='')}/copy", {"name": name})

    def preflight_agent(self, definition, bindings) -> SessionPreflight:
        return self.request("POST", "/agents/preflight", {"definition": definition, "bindings": bindings})

    def preflight_session(self, **definition) -> SessionPreflight:
        """Check bindings and structural compatibility; verification is separate from readiness."""
        return self.request("POST", "/sessions/preflight", definition)

    def list_connections(self):
        return self.request('GET', '/connections')

    def connection(self, connection_id):
        return self.request('GET', f"/connections/{quote(connection_id, safe='')}")

    def create_connection(self, **definition):
        return self.request("POST", "/connections", definition)

    def discover_mcp_tools(self, connection_id):
        return self.request('POST', f"/connections/{quote(connection_id, safe='')}/discover-mcp")

    def connection_authorization(self, connection_id):
        return self.request("GET", f"/connections/{quote(connection_id, safe='')}/authorization")

    def disconnect_connection(self, connection_id):
        return self.request("POST", f"/connections/{quote(connection_id, safe='')}/disconnect")

    def validate_connection(self, connection_id):
        return self.request("POST", f"/connections/{quote(connection_id, safe='')}/validate")

    def update_connection(self, connection_id, **changes):
        return self.request("PATCH", f"/connections/{quote(connection_id, safe='')}", changes)

    def delete_connection(self, connection_id):
        return self.request("DELETE", f"/connections/{quote(connection_id, safe='')}")

    def create_agent(self, *, env=None, **definition):
        """Create an Agent with optional write-only default environment variables."""
        if env is not None:
            definition["env"] = env
        return self.request("POST", "/agents", definition)

    def create_session(self, *, env=None, **definition):
        """Pin Agent defaults plus Session env overrides for initialization and Runs."""
        if env is not None:
            definition["env"] = env
        return self.request("POST", "/sessions", definition)

    def session_initialization(self, session_id):
        """Return the effective creation snapshot, without credential or environment values."""
        return self.request("GET", f"/sessions/{quote(session_id, safe='')}/initialization")

    def session(self, session_id):
        return self.request("GET", f"/sessions/{quote(session_id, safe='')}")

    def upload(self, session_id, files):
        """Upload a mapping of workspace-relative paths to bytes."""
        return self.request("POST", f"/sessions/{quote(session_id, safe='')}/files", {"files": [{"path": path, "content_base64": base64.b64encode(content).decode()} for path, content in files.items()]})

    def submit(self, session_id, text, idempotency_key, *, origin=None):
        return self.request("POST", f"/sessions/{quote(session_id, safe='')}/runs", {"input": text, **({"origin": origin} if origin is not None else {})}, {"Idempotency-Key": idempotency_key})

    def run(self, run_id):
        return self.request("GET", f"/runs/{quote(run_id, safe='')}")

    def tool_calls(self, run_id):
        return self.request("GET", f"/runs/{quote(run_id, safe='')}/tool-calls")

    def deny_tool_authorization(self, run_id, call_id, request_hash):
        return self.request("POST", f"/runs/{quote(run_id, safe='')}/tool-calls/{quote(call_id, safe='')}/deny-authorization", {"request_hash": request_hash})

    def resolve_tool_call(self, run_id, call_id, **resolution):
        return self.request("POST", f"/runs/{quote(run_id, safe='')}/tool-calls/{quote(call_id, safe='')}/resolve", resolution)

    def cancel(self, run_id):
        return self.request("POST", f"/runs/{quote(run_id, safe='')}/cancel")

    def pause(self, session_id, scope="session"):
        return self.request("POST", f"/sessions/{quote(session_id, safe='')}/pause", {"scope": scope})

    def resume(self, session_id):
        return self.request("POST", f"/sessions/{quote(session_id, safe='')}/resume")

    def session_activity(self, period="24h"):
        if period not in ("24h", "7d"):
            raise ValueError("period must be 24h or 7d")
        return self.request("GET", f"/sessions/activity?period={period}")

    def close(self, session_id):
        return self.request("POST", f"/sessions/{quote(session_id, safe='')}/close")

    def decide(self, approval_id, approved):
        return self.request("POST", f"/approvals/{quote(approval_id, safe='')}/decision", {"approved": approved})

    def events(self, run_id, after="0"):
        return self.request("GET", f"/runs/{quote(run_id, safe='')}/events?after={quote(str(after), safe='')}")

    def artifacts(self, run_id):
        return self.request("GET", f"/runs/{quote(run_id, safe='')}/artifacts")

    def download_artifact(self, artifact_id):
        with self._open("GET", f"/artifacts/{quote(artifact_id, safe='')}/content") as response:
            return response.read()

    def stream(self, run_id, after="0"):
        """Yield events; on disconnect reopen with the last yielded event id."""
        with self._open("GET", f"/runs/{quote(run_id, safe='')}/stream?after={quote(str(after), safe='')}", headers={"Accept": "text/event-stream"}) as response:
            event, data = {}, []
            for raw in response:
                line = raw.decode("utf-8").rstrip("\r\n")
                if not line:
                    if data:
                        event.setdefault("type", "message")
                        event["data"] = json.loads("\n".join(data))
                        yield event
                        if event["type"] == "stream.end":
                            return
                    event, data = {}, []
                elif line.startswith("id:"):
                    event["id"] = line[3:].lstrip()
                elif line.startswith("event:"):
                    event["type"] = line[6:].lstrip()
                elif line.startswith("data:"):
                    data.append(line[5:].lstrip())
            if data:
                raise ConnectionError("Truncated event stream; reconnect from last event id")
            raise ConnectionError("Event stream disconnected before terminal event; reconnect from last event id")
