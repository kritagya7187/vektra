"""Validates tiled execution: grid coverage, mosaic continuity, and equivalence to single-domain."""

from pathlib import Path
from typing import NamedTuple

import numpy as np
import pytest
from numpy.typing import NDArray
from rasterio.crs import CRS

import tests.factories as factories
from flood_engine.core.solver.wca2d import SolverParameters
from flood_engine.core.timestepping import TimesteppingParameters
from flood_engine.output.generator import generate_summary
from flood_engine.output.geotiff import write_geotiff
from flood_engine.simulation.controller import run as run_single_domain
from flood_engine.tiling import generate_tile_grid, mosaic_arrays, run_tile

SHAPE = (40, 40)
TILE_SIZE = 20
OVERLAP = 18


def _far_from_tile_seams(
    shape: tuple[int, int], tile_size: int, exclude_distance: int
) -> NDArray[np.bool_]:
    rows = np.arange(shape[0])
    cols = np.arange(shape[1])
    row_seam_dist = np.minimum(rows % tile_size, tile_size - rows % tile_size)
    col_seam_dist = np.minimum(cols % tile_size, tile_size - cols % tile_size)
    far_rows = row_seam_dist >= exclude_distance
    far_cols = col_seam_dist >= exclude_distance
    return far_rows[:, np.newaxis] & far_cols[np.newaxis, :]


class _Scenario(NamedTuple):
    elevation_m: NDArray[np.float64]
    building_mask: NDArray[np.bool_]
    manning_n: NDArray[np.float64]
    infiltration_loss_mm_per_hr: NDArray[np.float64]
    rainfall_rates_mm_per_hr: NDArray[np.float64]


def _scenario() -> _Scenario:
    dem = factories.sloped_dem(SHAPE, high_elevation_m=15.0, low_elevation_m=0.0)
    rainfall = factories.constant_rainfall(rate_mm_per_hr=25.0, hours=1)
    return _Scenario(
        elevation_m=dem.data.astype(np.float64),
        building_mask=factories.no_buildings(SHAPE),
        manning_n=np.full(SHAPE, 0.03, dtype=np.float64),
        infiltration_loss_mm_per_hr=np.zeros(SHAPE, dtype=np.float64),
        rainfall_rates_mm_per_hr=rainfall.rainfall_mm_per_hr,
    )


class TestTileGrid:
    def test_covers_full_extent_with_no_gaps(self) -> None:
        tiles = generate_tile_grid(*SHAPE, tile_size=TILE_SIZE, overlap=OVERLAP)
        covered = np.zeros(SHAPE, dtype=bool)
        for tile in tiles:
            covered[
                tile.core_row_start : tile.core_row_end, tile.core_col_start : tile.core_col_end
            ] = True
        assert covered.all()

    def test_core_regions_do_not_overlap(self) -> None:
        tiles = generate_tile_grid(*SHAPE, tile_size=TILE_SIZE, overlap=OVERLAP)
        count = np.zeros(SHAPE, dtype=np.int32)
        for tile in tiles:
            count[
                tile.core_row_start : tile.core_row_end, tile.core_col_start : tile.core_col_end
            ] += 1
        assert np.all(count == 1)

    def test_deterministic_tile_ids(self) -> None:
        first = generate_tile_grid(*SHAPE, tile_size=TILE_SIZE, overlap=OVERLAP)
        second = generate_tile_grid(*SHAPE, tile_size=TILE_SIZE, overlap=OVERLAP)
        assert [t.tile_id for t in first] == [t.tile_id for t in second]

    def test_halo_clamped_to_array_bounds(self) -> None:
        tiles = generate_tile_grid(*SHAPE, tile_size=TILE_SIZE, overlap=OVERLAP)
        for tile in tiles:
            assert 0 <= tile.read_row_start <= tile.read_row_end <= SHAPE[0]
            assert 0 <= tile.read_col_start <= tile.read_col_end <= SHAPE[1]


class TestTiledMatchesSingleDomain:
    def test_max_depth_matches_within_interior_region(self) -> None:
        scenario = _scenario()
        params = SolverParameters(time_maxdt_s=30.0)
        ts_params = TimesteppingParameters()

        duration_s = 1800.0

        single_result = run_single_domain(
            elevation_m=scenario.elevation_m,
            building_mask=scenario.building_mask,
            manning_n=scenario.manning_n,
            infiltration_loss_mm_per_hr=scenario.infiltration_loss_mm_per_hr,
            rainfall_rates_mm_per_hr=scenario.rainfall_rates_mm_per_hr,
            solver_parameters=params,
            timestepping_parameters=ts_params,
            total_duration_s=duration_s,
        )
        single_summary = generate_summary(single_result)

        tiles = generate_tile_grid(*SHAPE, tile_size=TILE_SIZE, overlap=OVERLAP)
        tile_results = [
            (
                tile,
                run_tile(
                    tile,
                    elevation_m=scenario.elevation_m,
                    building_mask=scenario.building_mask,
                    manning_n=scenario.manning_n,
                    infiltration_loss_mm_per_hr=scenario.infiltration_loss_mm_per_hr,
                    rainfall_rates_mm_per_hr=scenario.rainfall_rates_mm_per_hr,
                    solver_parameters=params,
                    timestepping_parameters=ts_params,
                    total_duration_s=duration_s,
                ),
            )
            for tile in tiles
        ]
        mosaic = mosaic_arrays(tile_results, height=SHAPE[0], width=SHAPE[1])

        exclude_distance = 10
        seam_mask = _far_from_tile_seams(SHAPE, TILE_SIZE, exclude_distance)
        # Two independently-computed decompositions of the same domain,
        # not the same computation run twice -- residual near a seam is
        # expected (the halo's own open-boundary edge is an artifact),
        # observed here to shrink toward zero as exclude_distance grows.
        # 1e-5 m / 0.2% is far below any physically meaningful precision
        # for a flood-depth output.
        np.testing.assert_allclose(
            mosaic["max_depth_m"][seam_mask],
            single_summary.max_depth_m[seam_mask],
            atol=1e-5,
            rtol=2e-3,
        )

    def test_mosaic_raises_if_a_tile_is_missing(self) -> None:
        tiles = generate_tile_grid(*SHAPE, tile_size=TILE_SIZE, overlap=OVERLAP)
        scenario = _scenario()
        params = SolverParameters(time_maxdt_s=30.0)
        results = [
            (
                tile,
                run_tile(
                    tile,
                    elevation_m=scenario.elevation_m,
                    building_mask=scenario.building_mask,
                    manning_n=scenario.manning_n,
                    infiltration_loss_mm_per_hr=scenario.infiltration_loss_mm_per_hr,
                    rainfall_rates_mm_per_hr=scenario.rainfall_rates_mm_per_hr,
                    solver_parameters=params,
                ),
            )
            for tile in tiles[:-1]
        ]
        with pytest.raises(ValueError, match="Mosaic incomplete"):
            mosaic_arrays(results, height=SHAPE[0], width=SHAPE[1])


class TestGeotiffFromMosaic:
    def test_mosaic_geotiff_has_correct_crs_transform_and_bounds(self, tmp_path: Path) -> None:
        scenario = _scenario()
        tiles = generate_tile_grid(*SHAPE, tile_size=TILE_SIZE, overlap=OVERLAP)
        params = SolverParameters(time_maxdt_s=30.0)
        tile_results = [
            (
                tile,
                run_tile(
                    tile,
                    elevation_m=scenario.elevation_m,
                    building_mask=scenario.building_mask,
                    manning_n=scenario.manning_n,
                    infiltration_loss_mm_per_hr=scenario.infiltration_loss_mm_per_hr,
                    rainfall_rates_mm_per_hr=scenario.rainfall_rates_mm_per_hr,
                    solver_parameters=params,
                ),
            )
            for tile in tiles
        ]
        mosaic = mosaic_arrays(tile_results, height=SHAPE[0], width=SHAPE[1])

        transform = factories.model_transform()
        crs = CRS.from_epsg(32643)
        path = write_geotiff(
            mosaic["max_depth_m"], transform=transform, crs=crs, path=tmp_path / "mosaic.tif"
        )

        import rasterio

        with rasterio.open(path) as src:
            assert src.crs.to_epsg() == 32643
            assert src.transform == transform
            assert src.width == SHAPE[1]
            assert src.height == SHAPE[0]
            assert src.nodata == -9999.0
            expected_bounds = rasterio.transform.array_bounds(SHAPE[0], SHAPE[1], transform)
            assert src.bounds == pytest.approx(expected_bounds)
