-- VEKTRA Database — Migration 0001
-- Enables required PostgreSQL extensions.
-- EDD reference: Section 12 (Technology Stack — PostgreSQL + PostGIS).
--
-- TODO: the exact target PostgreSQL version is "Not specified" in the EDD
-- (Section 12 states PostgreSQL + PostGIS is "already installed" without a
-- version number). This schema assumes PostgreSQL >= 13 and PostGIS >= 3.x
-- (required for gen_random_uuid() via pgcrypto and current PostGIS
-- function behavior). Verify against the actual deployment target before
-- applying in production.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
