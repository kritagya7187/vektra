# CI Configuration

GitHub Actions workflow for build, lint, and test execution on push/PR.

EDD reference: Section 12, Section 34.

Status: implemented (Phase 2I). The actual workflow lives at
`.github/workflows/ci.yml` — GitHub only discovers workflows under
`.github/workflows/` at the repository root, so no file lives in this
directory itself; this README documents what that workflow does.

Three jobs, each reusing the project's own existing npm scripts rather
than defining new checks:

- **backend** — `npm run typecheck`, `typecheck:test`, `lint`,
  `format:check`, `test:unit`, `test:integration`, `build`, all run from
  `backend/`. Integration tests use `testcontainers`
  (`backend/tests/helpers/globalSetup.ts`) to start their own disposable
  `postgis/postgis:16-3.4` container — no separate Postgres service is
  declared in the workflow.
- **frontend** — the same shape of checks, run from `frontend/`.
- **docker** — depends on both jobs above passing first; validates that
  every variable `docker-compose.yml` references is documented in the
  repository-root `.env.example`, runs `docker compose config` to
  validate the compose file itself, and builds both the `backend` and
  `frontend` images (`db` has no build step — it uses the upstream
  `postgis/postgis` image directly).

Not automated, and why:
- Any real, in-browser verification (Cesium rendering, entity picking,
  camera behavior, an actual `docker compose up` against a live
  frontend+backend+db stack) — this project has never had a
  browser/WebGL environment available at any phase, on GitHub-hosted
  runners or otherwise; automating it would require introducing new
  tooling (a headless browser stack) not currently justified by anything
  else in this repository.
- Deployment to any real environment — out of scope for this phase and
  for the EDD (Section 34: production deployment target is
  "Not specified").
