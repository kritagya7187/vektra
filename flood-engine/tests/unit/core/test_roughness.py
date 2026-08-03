"""Unit tests for flood_engine.core.solver.roughness."""

import numpy as np
import pytest

from flood_engine.core.solver.roughness import (
    BARE_SPARSE_VEGETATION,
    BUILDING_MANNING_N_PLACEHOLDER,
    BUILT_UP,
    CROPLAND,
    GRASSLAND,
    MANNING_N_BY_LANDCOVER_CLASS,
    PERMANENT_WATER_BODIES,
    SHRUBLAND,
    TREE_COVER,
    RoughnessError,
    roughness_grid,
)


class TestRoughnessGrid:
    def test_maps_every_known_class_to_its_table_value(self) -> None:
        codes = np.array(
            [[TREE_COVER, SHRUBLAND, GRASSLAND], [CROPLAND, BUILT_UP, BARE_SPARSE_VEGETATION]],
            dtype=np.uint8,
        )

        manning_n = roughness_grid(codes)

        for row in range(codes.shape[0]):
            for col in range(codes.shape[1]):
                expected = MANNING_N_BY_LANDCOVER_CLASS[int(codes[row, col])]
                assert manning_n[row, col] == expected

    def test_open_water_class(self) -> None:
        codes = np.full((2, 2), PERMANENT_WATER_BODIES, dtype=np.uint8)

        manning_n = roughness_grid(codes)

        expected = MANNING_N_BY_LANDCOVER_CLASS[PERMANENT_WATER_BODIES]
        np.testing.assert_array_equal(manning_n, expected)

    def test_output_shape_and_dtype(self) -> None:
        codes = np.full((5, 7), BUILT_UP, dtype=np.uint8)

        manning_n = roughness_grid(codes)

        assert manning_n.shape == (5, 7)
        assert manning_n.dtype == np.float64

    def test_unknown_class_code_raises(self) -> None:
        codes = np.array([[BUILT_UP, 200]], dtype=np.uint16)  # 200: not a real WorldCover code

        with pytest.raises(RoughnessError, match=r"\[200\]"):
            roughness_grid(codes)

    def test_multiple_unknown_class_codes_all_reported(self) -> None:
        codes = np.array([[201, 202]], dtype=np.uint16)

        with pytest.raises(RoughnessError, match=r"\[201, 202\]"):
            roughness_grid(codes)

    def test_every_value_strictly_positive(self) -> None:
        # DomainInputs.__post_init__ requires this -- verified directly
        # against the frozen table itself, not just spot-checked values.
        for value in MANNING_N_BY_LANDCOVER_CLASS.values():
            assert value > 0.0
        assert BUILDING_MANNING_N_PLACEHOLDER > 0.0


class TestBuildingMaskOverride:
    def test_building_cells_get_the_placeholder_regardless_of_landcover_code(self) -> None:
        codes = np.full((2, 2), TREE_COVER, dtype=np.uint8)
        building_mask = np.array([[True, False], [False, True]])

        manning_n = roughness_grid(codes, building_mask=building_mask)

        assert manning_n[0, 0] == BUILDING_MANNING_N_PLACEHOLDER
        assert manning_n[1, 1] == BUILDING_MANNING_N_PLACEHOLDER
        assert manning_n[0, 1] == MANNING_N_BY_LANDCOVER_CLASS[TREE_COVER]
        assert manning_n[1, 0] == MANNING_N_BY_LANDCOVER_CLASS[TREE_COVER]

    def test_unknown_landcover_code_under_a_building_does_not_raise(self) -> None:
        # A building footprint's own class code is irrelevant once masked
        # -- this is the entire point of accepting building_mask.
        codes = np.array([[250, BUILT_UP]], dtype=np.uint16)
        building_mask = np.array([[True, False]])

        manning_n = roughness_grid(codes, building_mask=building_mask)

        assert manning_n[0, 0] == BUILDING_MANNING_N_PLACEHOLDER

    def test_unknown_landcover_code_outside_a_building_still_raises(self) -> None:
        codes = np.array([[250, BUILT_UP]], dtype=np.uint16)
        building_mask = np.array([[False, False]])

        with pytest.raises(RoughnessError, match=r"\[250\]"):
            roughness_grid(codes, building_mask=building_mask)

    def test_mismatched_building_mask_shape_raises(self) -> None:
        codes = np.full((2, 2), BUILT_UP, dtype=np.uint8)
        building_mask = np.zeros((3, 3), dtype=np.bool_)

        with pytest.raises(RoughnessError, match="shape"):
            roughness_grid(codes, building_mask=building_mask)
