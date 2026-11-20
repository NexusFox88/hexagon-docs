CREATE TABLE IF NOT EXISTS tenants (
 id text PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS api_keys (
 digest text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id), label text NOT NULL,
 revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS secrets (
 tenant_id text NOT NULL REFERENCES tenants(id), id text NOT NULL, purpose text NOT NULL,
 envelope jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS connections (
 tenant_id text NOT NULL REFERENCES tenants(id), id text NOT NULL, kind text NOT NULL CHECK(kind IN ('sandbox','tool','model')),
 provider text NOT NULL, name text NOT NULL, config jsonb NOT NULL DEFAULT '{}', secret_id text,
 status text NOT NULL DEFAULT 'draft', enabled boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 validation jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,secret_id) REFERENCES secrets(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS agents (
 tenant_id text NOT NULL REFERENCES tenants(id), id text NOT NULL, name text NOT NULL,
 definition jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS sessions (
 tenant_id text NOT NULL REFERENCES tenants(id), id text NOT NULL, agent_id text NOT NULL,
 sandbox_connection_id text NOT NULL, model_connection_id text NOT NULL,
 definition jsonb NOT NULL, state text NOT NULL DEFAULT 'open', sandbox jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,agent_id) REFERENCES agents(tenant_id,id),
 FOREIGN KEY(tenant_id,sandbox_connection_id) REFERENCES connections(tenant_id,id),
 FOREIGN KEY(tenant_id,model_connection_id) REFERENCES connections(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS runs (
 tenant_id text NOT NULL, id text NOT NULL, session_id text NOT NULL, idempotency_key text NOT NULL,
 request_hash text NOT NULL, input text NOT NULL, state text NOT NULL DEFAULT 'queued', output jsonb, error jsonb,
 lease_owner text, lease_until timestamptz, generation integer NOT NULL DEFAULT 0,
 cancel_requested boolean NOT NULL DEFAULT false, runtime_cursor bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,session_id,idempotency_key),
 FOREIGN KEY(tenant_id,session_id) REFERENCES sessions(tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_run_per_session ON runs(tenant_id,session_id)
 WHERE state IN ('queued','provisioning','running','waiting_authorization','waiting_approval','cancelling');
CREATE TABLE IF NOT EXISTS events (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id text NOT NULL, run_id text NOT NULL,
 type text NOT NULL, data jsonb NOT NULL, source_key text,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,run_id) REFERENCES runs(tenant_id,id),
 UNIQUE(tenant_id,run_id,source_key)
);
CREATE INDEX IF NOT EXISTS events_run_cursor ON events(tenant_id,run_id,sequence);
CREATE TABLE IF NOT EXISTS approvals (
 tenant_id text NOT NULL, id text NOT NULL, run_id text NOT NULL, action jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending', decision jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,run_id) REFERENCES runs(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS artifacts (
 tenant_id text NOT NULL, id text NOT NULL, session_id text NOT NULL, run_id text,
 name text NOT NULL, storage_key text NOT NULL, sha256 text NOT NULL, size bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,session_id) REFERENCES sessions(tenant_id,id),
 FOREIGN KEY(tenant_id,run_id) REFERENCES runs(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS resource_operations (
 tenant_id text NOT NULL, id text NOT NULL, session_id text NOT NULL, kind text NOT NULL,
 state text NOT NULL DEFAULT 'pending', provider_resource_id text, detail jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,session_id) REFERENCES sessions(tenant_id,id)
);
