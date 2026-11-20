-- Sessions pin their own definition; a saved Agent is an optional template.
ALTER TABLE sessions ALTER COLUMN agent_id DROP NOT NULL;
ALTER TABLE sessions ALTER COLUMN agent_revision DROP NOT NULL;
