ALTER TABLE resource_operations ADD COLUMN attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE resource_operations ADD COLUMN review_state text NOT NULL DEFAULT 'automatic' CHECK(review_state IN ('automatic','needs_review','acknowledged'));
ALTER TABLE resource_operations ADD COLUMN last_checked_at timestamptz;
ALTER TABLE resource_operations ADD COLUMN next_check_at timestamptz;
CREATE TABLE resource_operation_reviews (
 tenant_id text NOT NULL, id text NOT NULL, operation_id text NOT NULL,
 action text NOT NULL CHECK(action IN ('acknowledge','reopen','reconcile')), note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,operation_id) REFERENCES resource_operations(tenant_id,id)
);
CREATE INDEX resource_operations_review ON resource_operations(tenant_id,review_state,next_check_at);
