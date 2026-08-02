"""Unit tests for flood_engine.core.grid.

Pure constant checks -- no I/O -- plus an explicit architectural guard
proving core/ stays rasterio-free even as it gains its first real module.
"""

import ast
import inspect

from flood_engine.core import grid


class TestGridConstants:
    def test_model_grid_epsg_code_is_utm_43n(self) -> None:
        assert grid.MODEL_GRID_EPSG_CODE == 32643

    def test_model_grid_resolution_is_30_meters(self) -> None:
        assert grid.MODEL_GRID_RESOLUTION_M == 30.0


class TestCoreGridStaysRasterioFree:
    """Architectural guard: core/ must never import rasterio.

    Step 1's rule, reconfirmed by the Step 6 audit. Parses this module's
    own source rather than relying on sys.modules
    (which could show rasterio as "already imported" for unrelated
    reasons elsewhere in the test session) -- a static, unambiguous check.
    """

    def test_grid_module_has_no_rasterio_import(self) -> None:
        source = inspect.getsource(grid)
        tree = ast.parse(source)

        imported_names: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported_names.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported_names.add(node.module)

        assert not any(name.startswith("rasterio") for name in imported_names)
