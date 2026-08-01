// Docker HEALTHCHECK probe — mirrors backend/healthcheck.js's approach
// (Node's built-in fetch, no curl/wget added to the runtime image just
// for this one check). This container has no /health API route to hit
// (it serves static files, not the backend's Express app) — the
// equivalent liveness signal for a static file server is "the root
// document is servable", so this requests `/` and accepts any 2xx.
const port = process.env.FRONTEND_PORT || 8080;

fetch(`http://127.0.0.1:${port}/`)
  .then((res) => {
    process.exit(res.status >= 200 && res.status < 300 ? 0 : 1);
  })
  .catch(() => {
    process.exit(1);
  });
