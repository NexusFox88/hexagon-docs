ALTER TABLE artifacts ADD COLUMN content bytea;
CREATE UNIQUE INDEX artifacts_run_name ON artifacts(tenant_id,run_id,name);
