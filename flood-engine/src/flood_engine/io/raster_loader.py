"""Raster loading: turns a georeferenced file on disk into a validated, immutable dataset.

This module treats raster loading as scientific integrity, not just file
I/O -- five frozen principles govern everything here:

1. **All mandatory spatial metadata is explicitly validated.** A raster
   with no CRS, no real georeferencing (identity/unset affine transform),
   or a degenerate array is rejected at construction time, not silently
   accepted and left to fail confusingly somewhere downstream.
2. **Loaded rasters are immutable domain objects, not (path -> ndarray).**
   :class:`RasterDataset` bundles the array together with its CRS,
   transform, and nodata value so metadata can never be dropped by
   passing the array around on its own, and the array's backing buffer is
   marked read-only so its content cannot be mutated in place either.
3. **Strict CRS policy: no silent reprojection.** :func:`load_raster`
   accepts an optional ``expected_crs`` and raises
   :class:`RasterCRSMismatchError` if the file's actual CRS differs -- it
   never reprojects on a caller's behalf. Reprojection is a separate,
   explicit preprocessing step (Step 7+), reviewable on its own.
4. **No hidden resampling.** This loader has no resolution/resampling
   parameters at all. A raster is read at its native resolution and
   pixel grid; changing either is, likewise, an explicit later step.
5. **Memory discipline without premature optimization.** ``load_raster``
   accepts an optional ``window`` so a sub-region can be read without
   loading the entire raster into memory -- a real, working capability,
   not a placeholder -- without committing to a full tiled/chunked
   processing pipeline before one is actually needed.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
import rasterio.windows
from numpy.typing import NDArray
from rasterio.coords import BoundingBox
from rasterio.crs import CRS
from rasterio.errors import RasterioIOError
from rasterio.transform import Affine, array_bounds
from rasterio.windows import Window

from flood_engine.logging_config import LogSubsystem, get_logger, log_duration, summarize_array

logger = get_logger(LogSubsystem.RASTER_IO, "raster_loader")


class RasterValidationError(Exception):
    """Raised when a raster fails a mandatory metadata check (see module docstring, principle 1)."""


class RasterCRSMismatchError(RasterValidationError):
    """Raised when a raster's actual CRS does not match an explicitly-expected CRS.

    Per the strict CRS policy (module docstring, principle 3): raising
    here, rather than reprojecting, is the point of this class existing.
    """

    def __init__(self, path: Path, actual: CRS, expected: CRS) -> None:
        """Build the error message from the mismatched CRS pair.

        Args:
            path: The raster file that was being loaded.
            actual: The CRS actually present in the file.
            expected: The CRS the caller required.
        """
        super().__init__(
            f"{path}: CRS is {actual.to_string()!r}, expected {expected.to_string()!r}. "
            "load_raster() never reprojects -- reproject explicitly before or after loading."
        )
        self.path = path
        self.actual = actual
        self.expected = expected


@dataclass(frozen=True, slots=True)
class RasterDataset:
    """An immutable, fully-validated in-memory single-band raster.

    Stores only the non-redundant source-of-truth fields -- ``data``,
    ``crs``, ``transform``, ``nodata``. ``width``, ``height``,
    ``resolution``, ``bounds``, and ``dtype`` are *derived* properties
    computed from those four, rather than separately-stored fields:
    storing all eight independently would let them silently disagree with
    each other (e.g. a stale ``resolution`` field that no longer matches
    ``transform``) -- deriving them removes that entire bug class rather
    than merely checking for it once at construction time.

    A frozen dataclass alone stops ``dataset.data = other_array``
    (reassigning the attribute) but does **not** stop
    ``dataset.data[0, 0] = 999`` (mutating the array's contents in place
    is a different operation) -- :meth:`__post_init__` marks the array's
    backing buffer read-only so both are blocked.
    """

    data: NDArray[Any]
    crs: CRS
    transform: Affine
    nodata: float | None

    def __post_init__(self) -> None:
        """Validate mandatory metadata and freeze the backing array buffer.

        Raises:
            RasterValidationError: if the CRS is undefined, the affine
                transform is degenerate (unset/identity/zero pixel size),
                or the array is not a non-empty 2D grid.
        """
        if self.crs is None:
            raise RasterValidationError(
                "Raster has no CRS -- refusing to construct an unreferenced RasterDataset."
            )
        if self.transform is None or self.transform.is_identity:
            raise RasterValidationError(
                "Raster has no real affine transform (identity/unset) -- it is not georeferenced."
            )
        if self.data.ndim != 2:
            raise RasterValidationError(f"Expected a 2D raster array, got shape {self.data.shape}.")
        if self.data.size == 0 or self.data.shape[0] <= 0 or self.data.shape[1] <= 0:
            raise RasterValidationError(f"Raster has a non-positive dimension: {self.data.shape}.")
        if abs(self.transform.a) == 0 or abs(self.transform.e) == 0:
            raise RasterValidationError("Raster has zero pixel size in the affine transform.")

        self.data.flags.writeable = False

    @property
    def height(self) -> int:
        """Row count -- from the array shape, the source of truth, not a separately stored field."""
        return int(self.data.shape[0])

    @property
    def width(self) -> int:
        """Column count -- from the array shape."""
        return int(self.data.shape[1])

    @property
    def resolution(self) -> tuple[float, float]:
        """Pixel size ``(x, y)`` in CRS units, derived from the affine transform."""
        return (abs(self.transform.a), abs(self.transform.e))

    @property
    def bounds(self) -> BoundingBox:
        """Spatial bounding box in CRS units, derived from the transform and array shape."""
        return BoundingBox(*array_bounds(self.height, self.width, self.transform))

    @property
    def dtype(self) -> np.dtype[Any]:
        """The array's dtype -- authoritative, not independently stored."""
        return self.data.dtype


def load_raster(
    path: Path,
    *,
    expected_crs: CRS | None = None,
    window: Window | None = None,
) -> RasterDataset:
    """Load a single-band georeferenced raster into a validated, immutable :class:`RasterDataset`.

    Never reprojects and never resamples -- see the module docstring's
    principles 3 and 4.

    Args:
        path: Path to a single-band raster file (e.g. GeoTIFF). Multi-band
            files are rejected explicitly rather than silently reading
            only the first band.
        expected_crs: If given, the file's CRS must equal this exactly or
            loading fails with :class:`RasterCRSMismatchError`. If
            ``None``, no CRS check is performed -- callers that need a
            specific CRS should always pass this rather than checking
            after the fact.
        window: If given, only this pixel window is read, with a
            correctly-offset transform -- supports processing a raster
            too large to hold in memory in one piece (module docstring
            principle 5) without loading the whole file. If ``None``, the
            entire raster is read.

    Returns:
        A validated, immutable :class:`RasterDataset`.

    Raises:
        FileNotFoundError: if ``path`` does not exist.
        RasterValidationError: if the file has more than one band, no
            CRS, no real georeferencing, or an empty/degenerate array.
        RasterCRSMismatchError: if ``expected_crs`` is given and does not
            match the file's actual CRS.
        rasterio.errors.RasterioIOError: if the file exists but cannot be
            opened/read (corrupt file, unsupported format, etc.).
    """
    if not path.exists():
        raise FileNotFoundError(f"Raster file does not exist: {path}")

    with log_duration(logger, "raster loaded", path=str(path)):
        try:
            with rasterio.open(path) as dataset:
                if dataset.count != 1:
                    raise RasterValidationError(
                        f"{path}: expected a single-band raster, found {dataset.count} bands. "
                        "Multi-band rasters are not a supported input to this loader."
                    )

                actual_crs = dataset.crs
                if expected_crs is not None and actual_crs != expected_crs:
                    raise RasterCRSMismatchError(path, actual_crs, expected_crs)

                # dataset.read() emits a DeprecationWarning under NumPy
                # 2.5+ ("Setting the shape on a NumPy array has been
                # deprecated") -- confirmed via direct investigation to
                # originate inside rasterio 1.5.0's own C/Cython read
                # path, not this code, and confirmed not to affect
                # correctness (returned shape/dtype/values all verified
                # correct). Left unsuppressed deliberately: NumPy
                # typically removes deprecated behavior in a later major
                # release, which would turn this into a real break for
                # every raster read in this codebase unless rasterio
                # ships a fix first -- worth noticing in CI output, not
                # worth hiding.
                if window is not None:
                    data = dataset.read(1, window=window)
                    transform = rasterio.windows.transform(window, dataset.transform)
                else:
                    data = dataset.read(1)
                    transform = dataset.transform

                nodata = dataset.nodata
        except RasterioIOError:
            logger.exception("Failed to open raster", extra={"path": str(path)})
            raise

        raster = RasterDataset(data=data, crs=actual_crs, transform=transform, nodata=nodata)

    logger.info(
        "raster metadata",
        extra={
            "path": str(path),
            "crs": raster.crs.to_string(),
            "width": raster.width,
            "height": raster.height,
            "resolution": raster.resolution,
            "nodata": raster.nodata,
            **summarize_array(raster.data, label="raster_data"),
        },
    )
    return raster
