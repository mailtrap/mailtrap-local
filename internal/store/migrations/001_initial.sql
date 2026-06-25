-- Baseline: tables come from schema.sql (idempotent CREATE IF NOT EXISTS).
-- This migration records version 1 for DBs that predate schema_version.
SELECT 1;
