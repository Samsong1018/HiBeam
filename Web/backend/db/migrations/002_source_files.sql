-- Adds storage for uploaded spreadsheets (excel sources, PUT /api/sources/:id/file).
-- Only needed for databases created before file_data was added to schema.sql.
ALTER TABLE sources ADD COLUMN file_data MEDIUMBLOB NULL AFTER key_last4;
