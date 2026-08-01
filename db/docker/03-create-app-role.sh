#!/bin/sh
# Runs automatically via the official postgres/postgis image's
# docker-entrypoint-initdb.d mechanism, on first container startup only
# (i.e. only when the data volume is empty) — after 01-schema.sql (which
# creates the vektra_backend_api NOLOGIN group role and its grants,
# migration 0014) and 02-seed-data-sources.sql have already run
# (alphabetical execution order).
#
# migration 0014's own comment: "Actual application login users must be
# created and granted membership in the appropriate role separately,
# through a secrets-managed provisioning process — never with a
# hardcoded password committed to version control." This script is that
# separate provisioning step for local/Compose deployment: the role name
# and password come only from environment variables (VEKTRA_APP_DB_USER /
# VEKTRA_APP_DB_PASSWORD, mapped in docker-compose.yml from the operator's
# own POSTGRES_USER / POSTGRES_PASSWORD — see this subsystem's review for
# why those can't be passed to this container under their original names
# without colliding with the postgres image's own bootstrap-superuser
# variables of the same name).
#
# Idempotent (IF NOT EXISTS / DO block) even though docker-entrypoint-
# initdb.d already only runs this once per fresh volume — cheap insurance
# against a manual re-run.
#
# Phase 2H (Docker & Deployment), added after real verification: this
# role is also granted vektra_ingestion and vektra_simulation, not only
# vektra_backend_api. Migration 0014 defines three separate group roles
# because the EDD's ORIGINAL conceptual layout (Section 9, 12) treated
# ingestion, simulation, and the API as three separate deployed
# services, each warranting its own minimally-scoped credential. The
# repository's ACTUAL, approved implementation collapses ingestion and
# simulation into CLI entry points that run inside this same backend
# container/image (backend/src/ingestion/run*.ts,
# backend/src/simulation/run*.ts — see docker-compose.yml's own header
# comment) — there is only one runtime identity that ever needs to
# authenticate as any of the three roles, not three. Without this grant,
# `docker compose run backend npm run ingest:osm` fails with "permission
# denied for table data_provenance_record" (vektra_backend_api alone
# only has SELECT on that table) — confirmed by running it. The
# underlying per-table grants in migration 0014 are unchanged and remain
# meaningful: if ingestion or simulation were ever split into a genuinely
# separate deployed process, it could be given its own, more narrowly
# scoped login role against this same, unmodified schema.
set -eu

: "${VEKTRA_APP_DB_USER:?VEKTRA_APP_DB_USER must be set}"
: "${VEKTRA_APP_DB_PASSWORD:?VEKTRA_APP_DB_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${VEKTRA_APP_DB_USER}') THEN
            CREATE ROLE "${VEKTRA_APP_DB_USER}" LOGIN PASSWORD '${VEKTRA_APP_DB_PASSWORD}';
        END IF;
    END
    \$\$;

    GRANT vektra_backend_api TO "${VEKTRA_APP_DB_USER}";
    GRANT vektra_ingestion TO "${VEKTRA_APP_DB_USER}";
    GRANT vektra_simulation TO "${VEKTRA_APP_DB_USER}";
EOSQL
