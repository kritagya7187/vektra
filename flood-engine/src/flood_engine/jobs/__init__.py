"""Infrastructure: asynchronous job queue for simulation runs.

Implements the async ``POST /flood-scenarios/{id}/runs`` contract from SDS
Section 8 — a CA simulation over many timesteps is not instant, so a run is
enqueued and executed out-of-band rather than blocking the request. This is
the first real justification in the project for an async job-queue
capability (flagged as a standing gap during the earlier EDDIE research);
it is scoped to flood runs only, not a general-purpose task system.
"""
