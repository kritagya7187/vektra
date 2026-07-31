// Docker HEALTHCHECK probe. Deliberately not curl/wget — Node 20+ ships a
// global fetch, so this avoids installing an extra OS package into the
// runtime image purely for this one check. Hits the real /health endpoint
// (health/healthRoute.ts) — the same endpoint every other verification in
// this project has used, not a synthetic substitute.
const port = process.env.BACKEND_PORT || 3000;

fetch(`http://127.0.0.1:${port}/health`)
  .then((res) => {
    process.exit(res.status === 200 ? 0 : 1);
  })
  .catch(() => {
    process.exit(1);
  });
