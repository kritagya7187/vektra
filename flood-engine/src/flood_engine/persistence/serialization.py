"""persistence.serialization: turning frozen domain types into storable forms and back.

Two kinds of serialization, per this step's own frozen scope:

1. Small, structured values (:class:`~flood_engine.core.state.MassLedger`)
   -> JSON, stored inline in a ``JSONB`` column.
2. The three large per-cell output arrays
   (:class:`~flood_engine.output.generator.FloodOutputSummary`) -> ``.npy``
   files on disk, with only the file *path* stored in the database --
   never an array inside PostgreSQL itself, per this step's own explicit
   instruction.

**Not yet real georeferenced rasters** -- per the plan record's frozen
Step 17 resolution: no CRS/transform is available anywhere in the
pipeline up to this point (`flood_engine.output.generator`'s own module
docstring explains why). Writing a ``.npy`` array dump is a documented,
explicit placeholder, not a finished raster product a GIS tool could
open -- the correct fix is threading the original DEM's georeferencing
through the pipeline, which is out of this step's scope.

Deliberately does not serialize internal solver state
(:class:`~flood_engine.core.state.SolverState`,
:class:`~flood_engine.core.solver.wca2d.StepResult`,
:class:`~flood_engine.core.timestepping.TimestepRecord`) -- only what
:class:`~flood_engine.simulation.controller.SimulationResult` and
:class:`~flood_engine.output.generator.FloodOutputSummary` already treat
as the durable, post-run product survives here, per this step's own
"only serialize outputs that survive beyond execution" scope.
"""

import json
from dataclasses import asdict
from pathlib import Path
from typing import cast

import numpy as np
from numpy.typing import NDArray

from flood_engine.core.state import MassLedger
from flood_engine.output.generator import FloodOutputSummary


def serialize_mass_ledger(ledger: MassLedger) -> str:
    """Encode a :class:`MassLedger` as a JSON string, for a ``JSONB`` column."""
    return json.dumps(asdict(ledger))


def deserialize_mass_ledger(payload: str) -> MassLedger:
    """Reconstruct a :class:`MassLedger` from its JSON encoding.

    Args:
        payload: The exact string :func:`serialize_mass_ledger` produced.
    """
    data = json.loads(payload)
    return MassLedger(**data)


def write_array(array: NDArray[np.float64], path: Path) -> None:
    """Write one summary array to disk as ``.npy``.

    Not yet a georeferenced raster -- see the module docstring.

    Args:
        array: The array to write.
        path: Destination, including the ``.npy`` extension. Parent
            directories are created if missing.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    np.save(path, array)


def read_array(path: Path) -> NDArray[np.float64]:
    """Read one summary array back from its ``.npy`` file, exactly as written."""
    # np.load's return type is Any (the .npy format can hold more than
    # arrays) -- cast, not ignore, since every caller here only ever
    # wrote a float64 array via write_array in the first place.
    return cast(NDArray[np.float64], np.load(path))


def output_array_paths(base_dir: Path, run_id: str) -> dict[str, Path]:
    """The three ``.npy`` file paths one run's output arrays are stored under.

    Args:
        base_dir: ``StorageConfig.flood_output_storage_dir``.
        run_id: The run these arrays belong to -- one subdirectory per run.

    Returns:
        A dict with keys ``max_depth``, ``arrival_time``,
        ``duration_above_threshold``, each mapping to a ``.npy`` path.
    """
    run_dir = base_dir / run_id
    return {
        "max_depth": run_dir / "max_depth.npy",
        "arrival_time": run_dir / "arrival_time.npy",
        "duration_above_threshold": run_dir / "duration_above_threshold.npy",
    }


def write_output_arrays(
    summary: FloodOutputSummary, *, base_dir: Path, run_id: str
) -> dict[str, str]:
    """Write all three of a run's summary arrays to disk.

    Args:
        summary: The completed run's output.
        base_dir: ``StorageConfig.flood_output_storage_dir``.
        run_id: The run these arrays belong to.

    Returns:
        A dict with the same three keys as :func:`output_array_paths`,
        each mapping to the written file's path as a string (ready to
        store in ``flood_simulation_output``'s ``*_location`` columns).
    """
    paths = output_array_paths(base_dir, run_id)
    write_array(summary.max_depth_m, paths["max_depth"])
    write_array(summary.arrival_time_min, paths["arrival_time"])
    write_array(summary.duration_above_threshold_min, paths["duration_above_threshold"])
    return {key: str(path) for key, path in paths.items()}


def read_output_summary(
    *,
    max_depth_location: str,
    arrival_time_location: str,
    duration_above_threshold_location: str,
    mass_ledger_json: str,
    step_count: int,
    simulated_duration_s: float,
) -> FloodOutputSummary:
    """Reconstruct a :class:`FloodOutputSummary` from a persisted output row's fields.

    Args:
        max_depth_location: One of the three ``.npy`` paths
            :func:`write_output_arrays` produced.
        arrival_time_location: One of the three ``.npy`` paths
            :func:`write_output_arrays` produced.
        duration_above_threshold_location: One of the three ``.npy``
            paths :func:`write_output_arrays` produced.
        mass_ledger_json: The exact string :func:`serialize_mass_ledger`
            produced.
        step_count: Plain scalar, stored and returned unmodified.
        simulated_duration_s: Plain scalar, stored and returned unmodified.
    """
    return FloodOutputSummary(
        max_depth_m=read_array(Path(max_depth_location)),
        arrival_time_min=read_array(Path(arrival_time_location)),
        duration_above_threshold_min=read_array(Path(duration_above_threshold_location)),
        mass_ledger=deserialize_mass_ledger(mass_ledger_json),
        step_count=step_count,
        simulated_duration_s=simulated_duration_s,
    )


__all__ = [
    "deserialize_mass_ledger",
    "output_array_paths",
    "read_array",
    "read_output_summary",
    "serialize_mass_ledger",
    "write_array",
    "write_output_arrays",
]
