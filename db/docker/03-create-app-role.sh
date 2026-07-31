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
EOSQL
