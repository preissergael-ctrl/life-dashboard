-- One-time upgrade for a database created before email support (new databases: schema.sql has everything).
-- Run: npx wrangler d1 execute life-dashboard-push --remote --file migrate-001-mail.sql
--  then: npx wrangler d1 execute life-dashboard-push --remote --file schema.sql
ALTER TABLE devices ADD COLUMN hide_names INTEGER NOT NULL DEFAULT 0;
