# Docker

Per-service images, orchestrated by the repository-root `docker-compose.yml`: `db` (upstream `postgis/postgis` image, no build step), `backend` (`backend/Dockerfile`), `frontend` (`frontend/Dockerfile`). Data ingestion runs as one-shot CLI commands against the `backend` image (`docker compose run --rm backend npm run ingest:osm`) rather than as its own service — see `docker-compose.yml`'s own header comment.

The `flood-engine/` Python microservice is not yet wired into this compose file.

Status: implemented — see [`infra/ci/README.md`](../ci/README.md) for what CI validates.
