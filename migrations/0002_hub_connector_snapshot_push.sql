ALTER TABLE connections ADD COLUMN snapshot_push_token TEXT;
INSERT INTO schema_migrations (version) VALUES ('0002_hub_connector_snapshot_push');

-- DOWN:
DELETE FROM schema_migrations WHERE version = '0002_hub_connector_snapshot_push';
ALTER TABLE connections DROP COLUMN snapshot_push_token;
