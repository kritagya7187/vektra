"""Deterministic tile-grid generation with halo padding for chunked WCA2D execution."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class TileSpec:
    """One tile: its core (non-overlapping) region and its halo-padded read region."""

    tile_id: str
    row: int
    col: int
    core_row_start: int
    core_row_end: int
    core_col_start: int
    core_col_end: int
    read_row_start: int
    read_row_end: int
    read_col_start: int
    read_col_end: int

    @property
    def core_offset_in_read(self) -> tuple[int, int]:
        """Row/col offset of the core region within this tile's own read window."""
        return (
            self.core_row_start - self.read_row_start,
            self.core_col_start - self.read_col_start,
        )


def generate_tile_grid(
    height: int, width: int, *, tile_size: int, overlap: int
) -> tuple[TileSpec, ...]:
    """Partition a (height, width) grid into tile_size x tile_size core blocks with a halo.

    Deterministic, row-major tile_id ("r{row}_c{col}") -- reruns of the
    same (height, width, tile_size, overlap) always produce the identical
    tile set, which is what makes a tile manifest reproducible.
    """
    if tile_size <= 0:
        raise ValueError(f"tile_size must be positive, got {tile_size}.")
    if overlap < 0:
        raise ValueError(f"overlap must be non-negative, got {overlap}.")

    n_rows = (height + tile_size - 1) // tile_size
    n_cols = (width + tile_size - 1) // tile_size

    tiles = []
    for row in range(n_rows):
        core_row_start = row * tile_size
        core_row_end = min(core_row_start + tile_size, height)
        for col in range(n_cols):
            core_col_start = col * tile_size
            core_col_end = min(core_col_start + tile_size, width)

            tiles.append(
                TileSpec(
                    tile_id=f"r{row}_c{col}",
                    row=row,
                    col=col,
                    core_row_start=core_row_start,
                    core_row_end=core_row_end,
                    core_col_start=core_col_start,
                    core_col_end=core_col_end,
                    read_row_start=max(0, core_row_start - overlap),
                    read_row_end=min(height, core_row_end + overlap),
                    read_col_start=max(0, core_col_start - overlap),
                    read_col_end=min(width, core_col_end + overlap),
                )
            )
    return tuple(tiles)


__all__ = ["TileSpec", "generate_tile_grid"]
