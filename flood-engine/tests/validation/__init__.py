"""Step 18 deliverables: validation, regression, benchmark, determinism, error recovery.

Distinct from ``tests/unit/`` ("does this function work in isolation")
and ``tests/integration/`` ("does this function work against real
I/O") -- every test here validates a property of the *complete model*
(``simulation.controller.run()`` end to end), per the Step 18 prompt's
own Part C/D/E/F/G framing. See ``flood-engine/VALIDATION.md`` (Part H)
for the methodology and results these tests establish.
"""
