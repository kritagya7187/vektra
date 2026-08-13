"""Runs the unmodified WCA2D solver per tile and mosaics results, trimming the halo."""

from collections.abc import Sequence

import numpy as np
from numpy.typing import NDArray

from flood_engine.core.solver.wca2d import SolverParameters
from flood_engine.core.timestepping import TimesteppingParameters
from flood_engine.output.generator import FloodOutputSummary, generate_summary
from flood_engine.simulation.controller import run as run_simulation
from flood_engine.tiling.grid import TileSpec


def run_tile(
    tile: TileSpec,
    *,
    elevation_m: NDArray[np.float64],
    building_mask: NDArray[np.bool_],
    manning_n: NDArray[np.float64],
    infiltration_loss_mm_per_hr: NDArray[np.float64],
    rainfall_rates_mm_per_hr: NDArray[np.float64],
    solver_parameters: SolverParameters | None = None,
    timestepping_parameters: TimesteppingParameters | None = None,
    total_duration_s: float | None = None,
) -> FloodOutputSummary:
    """Run the exact, unmodified simulation.controller.run() over one tile's read window."""
    row_slice = slice(tile.read_row_start, tile.read_row_end)
    col_slice = slice(tile.read_col_start, tile.read_col_end)

    result = run_simulation(
        elevation_m=elevation_m[row_slice, col_slice],
        building_mask=building_mask[row_slice, col_slice],
        manning_n=manning_n[row_slice, col_slice],
        infiltration_loss_mm_per_hr=infiltration_loss_mm_per_hr[row_slice, col_slice],
        rainfall_rates_mm_per_hr=rainfall_rates_mm_per_hr,
        solver_parameters=solver_parameters,
        timestepping_parameters=timestepping_parameters,
        total_duration_s=total_duration_s,
    )
    return generate_summary(result)


def mosaic_arrays(
    tile_results: Sequence[tuple[TileSpec, FloodOutputSummary]],
    *,
    height: int,
    width: int,
) -> dict[str, NDArray[np.float64]]:
    """Assemble full-extent arrays from each tile's core (halo-trimmed) region."""
    max_depth_m = np.zeros((height, width), dtype=np.float64)
    arrival_time_min = np.full((height, width), np.nan, dtype=np.float64)
    duration_above_threshold_min = np.zeros((height, width), dtype=np.float64)
    covered = np.zeros((height, width), dtype=np.bool_)

    for tile, summary in tile_results:
        row_off, col_off = tile.core_offset_in_read
        core_h = tile.core_row_end - tile.core_row_start
        core_w = tile.core_col_end - tile.core_col_start
        local_rows = slice(row_off, row_off + core_h)
        local_cols = slice(col_off, col_off + core_w)
        global_rows = slice(tile.core_row_start, tile.core_row_end)
        global_cols = slice(tile.core_col_start, tile.core_col_end)

        max_depth_m[global_rows, global_cols] = summary.max_depth_m[local_rows, local_cols]
        arrival_time_min[global_rows, global_cols] = summary.arrival_time_min[
            local_rows, local_cols
        ]
        duration_above_threshold_min[global_rows, global_cols] = (
            summary.duration_above_threshold_min[local_rows, local_cols]
        )
        covered[global_rows, global_cols] = True

    if not np.all(covered):
        missing = int(np.sum(~covered))
        raise ValueError(f"Mosaic incomplete: {missing} cell(s) not covered by any tile.")

    return {
        "max_depth_m": max_depth_m,
        "arrival_time_min": arrival_time_min,
        "duration_above_threshold_min": duration_above_threshold_min,
    }


__all__ = ["mosaic_arrays", "run_tile"]
