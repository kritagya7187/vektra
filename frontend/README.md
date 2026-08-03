# Visualization Subsystem

TypeScript + MapLibre GL JS + deck.gl 3D web client. Depends only on the backend API layer (`/api/*`, including the flood-simulation proxy routes) — no access to raw source datasets or the simulation engine directly.

Renders the building digital twin (footprints, attributes, provenance) and, as of Step 20, the flood-engine digital twin (job submission/lifecycle, Google Photorealistic 3D Tiles, and the three real Step 14 summary layers — max depth, arrival time, duration above threshold). See [MAPLIBRE_INTEGRATION.md](./MAPLIBRE_INTEGRATION.md) for the flood-visualization architecture, config, and known limitations.

See the repository root [README.md](../README.md) for how this subsystem fits into the overall project.
