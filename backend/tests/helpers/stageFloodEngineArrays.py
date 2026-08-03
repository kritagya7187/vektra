"""Writes a minimal, valid set of .npy input arrays for Step 19's Node integration tests.

Invoked as a one-shot subprocess from tests/helpers/floodEngineServer.ts
(and floodEngine.test.ts directly) -- reuses the real numpy/flood_engine
serialization code path rather than hand-encoding the .npy binary format
in TypeScript, which would risk a subtly-wrong encoder no test could
distinguish from a genuine bug. Mirrors flood-engine's own
tests/integration/test_postgres_job_repository.py::_stage_scenario_arrays
shape exactly (a tiny 2x2 domain, flat elevation, no buildings).

Usage: python stageFloodEngineArrays.py <output_dir> [--broken-manning-shape]
Writes elevation.npy, building_mask.npy, manning_n.npy, infiltration.npy,
rainfall.npy into <output_dir> and prints their absolute paths as JSON to
stdout for the calling Node process to parse.

``--broken-manning-shape`` deliberately writes manning_n.npy with a
different shape than every other array -- the same real
WCA2DError-triggering scenario flood-engine's own Python error-recovery
tests use (tests/integration/test_error_recovery.py::_enqueue_broken_run)
-- for Step 19's "a failed job" integration test, which needs a
genuine execution failure, not a fabricated status.
"""

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "flood-engine" / "src"))

from flood_engine.persistence.serialization import write_array  # noqa: E402

SHAPE = (2, 2)
BROKEN_MANNING_SHAPE = (4, 4)


def main() -> None:
    output_dir = Path(sys.argv[1])
    output_dir.mkdir(parents=True, exist_ok=True)
    broken_manning_shape = "--broken-manning-shape" in sys.argv[2:]

    paths = {
        "elevationPath": output_dir / "elevation.npy",
        "buildingMaskPath": output_dir / "building_mask.npy",
        "manningNPath": output_dir / "manning_n.npy",
        "infiltrationLossPath": output_dir / "infiltration.npy",
        "rainfallRatesPath": output_dir / "rainfall.npy",
    }
    write_array(np.full(SHAPE, 10.0), paths["elevationPath"])
    write_array(np.zeros(SHAPE), paths["buildingMaskPath"])
    manning_shape = BROKEN_MANNING_SHAPE if broken_manning_shape else SHAPE
    write_array(np.full(manning_shape, 0.03), paths["manningNPath"])
    write_array(np.zeros(SHAPE), paths["infiltrationLossPath"])
    write_array(np.array([5.0]), paths["rainfallRatesPath"])

    print(json.dumps({key: str(value) for key, value in paths.items()}))


if __name__ == "__main__":
    main()
