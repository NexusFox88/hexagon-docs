CREATE TABLE session_runtimes (
 tenant_id text NOT NULL, session_id text NOT NULL, secret_id text NOT NULL,
 state text NOT NULL DEFAULT 'reserved', native_session text,
 PRIMARY KEY(tenant_id,session_id),
 FOREIGN KEY(tenant_id,session_id) REFERENCES sessions(tenant_id,id),
 FOREIGN KEY(tenant_id,secret_id) REFERENCES secrets(tenant_id,id)
);
CREATE TABLE run_invocations (
 tenant_id text NOT NULL, run_id text NOT NULL, secret_id text NOT NULL,
 PRIMARY KEY(tenant_id,run_id),
 FOREIGN KEY(tenant_id,run_id) REFERENCES runs(tenant_id,id),
 FOREIGN KEY(tenant_id,secret_id) REFERENCES secrets(tenant_id,id)
);
