"""Unit tests for flood_engine.core.solver.infiltration."""

import numpy as np
import pytest

from flood_engine.core.solver.infiltration import (
    BUILDING_INFILTRATION_RATE_MM_PER_HR,
    IMPERVIOUS_INFILTRATION_RATE_MM_PER_HR,
    INFILTRATION_RATE_BY_LANDCOVER_CLASS,
    PERVIOUS_HSG_D_INFILTRATION_RATE_MM_PER_HR,
    InfiltrationError,
    infiltration_grid,
)
from flood_engine.core.solver.roughness import (
    BARE_SPARSE_VEGETATION,
    BUILT_UP,
    CROPLAND,
    GRASSLAND,
    PERMANENT_WATER_BODIES,
    SHRUBLAND,
    TREE_COVER,
)


class TestInfiltrationGrid:
    def test_impervious_classes_are_zero(self) -> None:
        codes = np.array([[BUILT_UP, PERMANENT_WATER_BODIES]], dtype=np.uint8)

        rate = infiltration_grid(codes)

        np.testing.assert_array_equal(rate, IMPERVIOUS_INFILTRATION_RATE_MM_PER_HR)

    def test_every_pervious_class_shares_the_single_hsg_d_rate(self) -> None:
        pervious_classes = [TREE_COVER, SHRUBLAND, GRASSLAND, CROPLAND, BARE_SPARSE_VEGETATION]
        codes = np.array([pervious_classes], dtype=np.uint8)

        rate = infiltration_grid(codes)

        np.testing.assert_array_equal(rate, PERVIOUS_HSG_D_INFILTRATION_RATE_MM_PER_HR)

    def test_output_shape_and_dtype(self) -> None:
        codes = np.full((4, 6), GRASSLAND, dtype=np.uint8)

        rate = infiltration_grid(codes)

        assert rate.shape == (4, 6)
        assert rate.dtype == np.float64

    def test_unknown_class_code_raises(self) -> None:
        codes = np.array([[BUILT_UP, 210]], dtype=np.uint16)

        with pytest.raises(InfiltrationError, match=r"\[210\]"):
            infiltration_grid(codes)

    def test_rates_are_non_negative(self) -> None:
        for value in INFILTRATION_RATE_BY_LANDCOVER_CLASS.values():
            assert value >= 0.0
        assert BUILDING_INFILTRATION_RATE_MM_PER_HR >= 0.0

    def test_pervious_rate_within_published_hsg_d_range(self) -> None:
        # Musgrave 1955 Group D minimum-infiltration-rate range: 0-1.3 mm/hr.
        assert 0.0 <= PERVIOUS_HSG_D_INFILTRATION_RATE_MM_PER_HR <= 1.3


class TestBuildingMaskOverride:
    def test_building_cells_get_zero_regardless_of_landcover_code(self) -> None:
        codes = np.full((2, 2), TREE_COVER, dtype=np.uint8)
        building_mask = np.array([[True, False], [False, True]])

        rate = infiltration_grid(codes, building_mask=building_mask)

        assert rate[0, 0] == BUILDING_INFILTRATION_RATE_MM_PER_HR
        assert rate[1, 1] == BUILDING_INFILTRATION_RATE_MM_PER_HR
        assert rate[0, 1] == PERVIOUS_HSG_D_INFILTRATION_RATE_MM_PER_HR
        assert rate[1, 0] == PERVIOUS_HSG_D_INFILTRATION_RATE_MM_PER_HR

    def test_unknown_landcover_code_under_a_building_does_not_raise(self) -> None:
        codes = np.array([[260, BUILT_UP]], dtype=np.uint16)
        building_mask = np.array([[True, False]])

        rate = infiltration_grid(codes, building_mask=building_mask)

        assert rate[0, 0] == BUILDING_INFILTRATION_RATE_MM_PER_HR

    def test_unknown_landcover_code_outside_a_building_still_raises(self) -> None:
        codes = np.array([[260, BUILT_UP]], dtype=np.uint16)
        building_mask = np.array([[False, False]])

        with pytest.raises(InfiltrationError, match=r"\[260\]"):
            infiltration_grid(codes, building_mask=building_mask)

    def test_mismatched_building_mask_shape_raises(self) -> None:
        codes = np.full((2, 2), BUILT_UP, dtype=np.uint8)
        building_mask = np.zeros((3, 3), dtype=np.bool_)

        with pytest.raises(InfiltrationError, match="shape"):
            infiltration_grid(codes, building_mask=building_mask)
