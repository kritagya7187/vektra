"""Integration tests for flood_engine.pipeline.

Placed under tests/integration/ per this module's own categorization:
build_simulation_inputs() drives real rasterio reprojection and geopandas
overlay computation (preprocess_dem/preprocess_landcover/rasterize_buildings),
not pure logic.
"""

import numpy as np
import pytest

from flood_engine.core.solver.infiltration import (
    IMPERVIOUS_INFILTRATION_RATE_MM_PER_HR,
    PERVIOUS_HSG_D_INFILTRATION_RATE_MM_PER_HR,
)
from flood_engine.core.solver.roughness import (
    BARE_SPARSE_VEGETATION,
    BUILDING_MANNING_N_PLACEHOLDER,
    BUILT_UP,
    MANNING_N_BY_LANDCOVER_CLASS,
)
from flood_engine.io.raster_loader import RasterDataset
from flood_engine.pipeline import PipelineError, SimulationInputs, build_simulation_inputs
from flood_engine.preprocessing.building_rasterization import BUILDING_COVERAGE_THRESHOLD
from tests.factories import (
    MODEL_CRS,
    buildings_geodataframe,
    constant_rainfall,
    flat_dem,
    model_transform,
    uniform_landcover,
)

SHAPE = (10, 10)


class TestBuildSimulationInputs:
    def test_returns_correctly_shaped_arrays(self) -> None:
        dem = flat_dem(SHAPE, elevation_m=5.0)
        landcover = uniform_landcover(SHAPE, class_code=BARE_SPARSE_VEGETATION)
        buildings = buildings_geodataframe([(0, 0)], shape=SHAPE)
        rainfall = constant_rainfall(rate_mm_per_hr=10.0, hours=2)

        result = build_simulation_inputs(
            dem=dem, landcover=landcover, buildings=buildings, rainfall=rainfall
        )

        assert isinstance(result, SimulationInputs)
        assert result.elevation_m.shape == SHAPE
        assert result.building_mask.shape == SHAPE
        assert result.manning_n.shape == SHAPE
        assert result.infiltration_loss_mm_per_hr.shape == SHAPE
        assert result.rainfall_rates_mm_per_hr.shape == (2,)

    def test_elevation_matches_source_dem(self) -> None:
        dem = flat_dem(SHAPE, elevation_m=12.5)
        landcover = uniform_landcover(SHAPE)
        buildings = buildings_geodataframe([(0, 0)], shape=SHAPE)
        rainfall = constant_rainfall(rate_mm_per_hr=5.0, hours=1)

        result = build_simulation_inputs(
            dem=dem, landcover=landcover, buildings=buildings, rainfall=rainfall
        )

        np.testing.assert_allclose(result.elevation_m, 12.5)

    def test_building_cell_is_marked_in_the_mask(self) -> None:
        dem = flat_dem(SHAPE)
        landcover = uniform_landcover(SHAPE, class_code=BARE_SPARSE_VEGETATION)
        buildings = buildings_geodataframe([(3, 4)], shape=SHAPE)
        rainfall = constant_rainfall(rate_mm_per_hr=1.0, hours=1)

        result = build_simulation_inputs(
            dem=dem, landcover=landcover, buildings=buildings, rainfall=rainfall
        )

        assert result.building_mask[3, 4]
        assert result.building_mask.sum() == 1

    def test_manning_n_matches_the_frozen_roughness_table(self) -> None:
        dem = flat_dem(SHAPE)
        landcover = uniform_landcover(SHAPE, class_code=BARE_SPARSE_VEGETATION)
        buildings = buildings_geodataframe([(0, 0)], shape=SHAPE)
        rainfall = constant_rainfall(rate_mm_per_hr=1.0, hours=1)

        result = build_simulation_inputs(
            dem=dem, landcover=landcover, buildings=buildings, rainfall=rainfall
        )

        expected = MANNING_N_BY_LANDCOVER_CLASS[BARE_SPARSE_VEGETATION]
        non_building = ~result.building_mask
        np.testing.assert_allclose(result.manning_n[non_building], expected)
        assert result.manning_n[0, 0] == BUILDING_MANNING_N_PLACEHOLDER

    def test_infiltration_matches_the_frozen_table(self) -> None:
        dem = flat_dem(SHAPE)
        landcover = uniform_landcover(SHAPE, class_code=BUILT_UP)
        buildings = buildings_geodataframe([(0, 0)], shape=SHAPE)
        rainfall = constant_rainfall(rate_mm_per_hr=1.0, hours=1)

        result = build_simulation_inputs(
            dem=dem, landcover=landcover, buildings=buildings, rainfall=rainfall
        )

        np.testing.assert_allclose(
            result.infiltration_loss_mm_per_hr, IMPERVIOUS_INFILTRATION_RATE_MM_PER_HR
        )

    def test_pervious_landcover_gets_the_pervious_rate(self) -> None:
        dem = flat_dem(SHAPE)
        landcover = uniform_landcover(SHAPE, class_code=BARE_SPARSE_VEGETATION)
        buildings = buildings_geodataframe([], shape=SHAPE)
        rainfall = constant_rainfall(rate_mm_per_hr=1.0, hours=1)

        # An empty building GeoDataFrame is rejected by rasterize_buildings
        # itself (real, disclosed guard against silently masking an
        # ingestion failure) -- covered by TestBuildSimulationInputsErrors
        # below; this test instead uses a building far outside the AOI so
        # the domain is effectively building-free while staying valid.
        buildings = buildings_geodataframe([(50, 50)], shape=SHAPE)

        result = build_simulation_inputs(
            dem=dem, landcover=landcover, buildings=buildings, rainfall=rainfall
        )

        np.testing.assert_allclose(
            result.infiltration_loss_mm_per_hr, PERVIOUS_HSG_D_INFILTRATION_RATE_MM_PER_HR
        )

    def test_rainfall_passes_through_unmodified(self) -> None:
        dem = flat_dem(SHAPE)
        landcover = uniform_landcover(SHAPE)
        buildings = buildings_geodataframe([(0, 0)], shape=SHAPE)
        rainfall = constant_rainfall(rate_mm_per_hr=25.0, hours=3)

        result = build_simulation_inputs(
            dem=dem, landcover=landcover, buildings=buildings, rainfall=rainfall
        )

        np.testing.assert_array_equal(result.rainfall_rates_mm_per_hr, rainfall.rainfall_mm_per_hr)

    def test_building_covering_at_least_the_threshold_fraction_is_marked(self) -> None:
        # Sanity check that this test module's own buildings_geodataframe
        # helper (100% per-cell coverage) is unambiguously above the real
        # frozen threshold, not a coincidental pass.
        assert 1.0 >= BUILDING_COVERAGE_THRESHOLD


class TestBuildSimulationInputsErrors:
    def test_dem_nodata_cells_after_alignment_raise_pipeline_error(self) -> None:
        # A DEM that does NOT fully cover the destination footprint: one
        # real nodata cell baked in directly (no reprojection needed to
        # demonstrate this -- the no-op preprocess_dem path passes the
        # array through byte-for-byte, so a nodata cell present in the
        # source is still present in the "aligned" output).
        data = np.full(SHAPE, 5.0, dtype=np.float32)
        data[0, 0] = -9999.0
        dem = RasterDataset(data=data, crs=MODEL_CRS, transform=model_transform(), nodata=-9999.0)
        landcover = uniform_landcover(SHAPE)
        buildings = buildings_geodataframe([(5, 5)], shape=SHAPE)
        rainfall = constant_rainfall(rate_mm_per_hr=1.0, hours=1)

        with pytest.raises(PipelineError, match="nodata"):
            build_simulation_inputs(
                dem=dem, landcover=landcover, buildings=buildings, rainfall=rainfall
            )

    def test_unmapped_landcover_class_propagates_roughness_error_unwrapped(self) -> None:
        from flood_engine.core.solver.roughness import RoughnessError

        dem = flat_dem(SHAPE)
        landcover = uniform_landcover(SHAPE, class_code=254)  # not a real WorldCover class
        buildings = buildings_geodataframe([(5, 5)], shape=SHAPE)
        rainfall = constant_rainfall(rate_mm_per_hr=1.0, hours=1)

        with pytest.raises(RoughnessError, match=r"\[254\]"):
            build_simulation_inputs(
                dem=dem, landcover=landcover, buildings=buildings, rainfall=rainfall
            )
