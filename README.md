# VEKTRA

Building-Level Urban Heat Resilience Digital Twin for South Mumbai.
<img width="1376" height="768" alt="VEKTRA_Logo" src="https://github.com/user-attachments/assets/e44d2692-e117-40a7-bbec-6decee727c8a" />

Monorepo per the Engineering Design Document (Section 35). Modules:

- `ingestion/` — per-source ETL jobs (Section 10, 14)
- `simulation/` — deterministic Heat Exposure Index engine (Section 17)
- `backend/` — REST API layer (Section 21, 23)
- `frontend/` — CesiumJS visualization client (Section 20, 22)
- `db/` — schema migrations and conceptual model documentation (Section 16)
- `infra/` — Docker Compose and CI configuration (Section 34)
- `docs/` — design artifacts (Section 35)

See `VEKTRA_Engineering_Design_Document.md` at the repository root for the full approved design.

Status: repository scaffolding only. No implementation yet.
