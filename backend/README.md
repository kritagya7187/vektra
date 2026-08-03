# API Subsystem

Node.js + TypeScript REST-style API mediating all read/write access to persisted and derived data. The frontend does not access the database directly.

Also hosts the data ingestion CLI entry points (`npm run ingest:*` — OSM, remote sensing, meteorological) that populate the shared PostGIS database `flood-engine/` and the frontend both read from.

See the repository root [README.md](../README.md) for how this subsystem fits into the overall project.
