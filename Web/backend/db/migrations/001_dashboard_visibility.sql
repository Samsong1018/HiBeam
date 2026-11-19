-- Adds the public/private flag used by PATCH /api/dashboards/:id/visibility.
-- Only needed for databases created before is_public was added to schema.sql.
ALTER TABLE dashboards ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 0 AFTER definition;
