"""Simulation controller: orchestrates ``core`` over real scenario inputs.

Takes a validated ``flood_engine.scenario`` object plus already-loaded
``flood_engine.inputs``, drives the ``core`` solver/timestepping/
conservation-check loop to completion, and produces the NMS "derived-post-run
summaries" (max depth, arrival time, duration, derived velocity) as the
``flood_engine.simulation.outputs`` module. Operates entirely on in-memory
arrays and domain objects — it does not read from or write to disk, a
database, or a raster store itself; callers in ``flood_engine.api``/
``flood_engine.jobs`` are responsible for loading inputs beforehand and
persisting outputs afterward via ``flood_engine.io``/
``flood_engine.persistence``.
"""
