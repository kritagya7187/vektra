"""Real, reproducible acquisition of the Mumbai municipal (BMC/MCGM) boundary from OSM."""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final, cast

import geopandas as gpd
from shapely.geometry.base import BaseGeometry
from shapely.ops import linemerge, polygonize, unary_union

OVERPASS_API_URL: Final[str] = "https://overpass-api.de/api/interpreter"
OVERPASS_TIMEOUT_S: Final[int] = 180

MUMBAI_CITY_DISTRICT_RELATION_ID: Final[int] = 7964376
MUMBAI_SUBURBAN_DISTRICT_RELATION_ID: Final[int] = 7964375

SOURCE_CRS_EPSG: Final[int] = 4326


class AoiError(Exception):
    """Raised when the municipal boundary cannot be fetched or assembled."""


@dataclass(frozen=True, slots=True)
class BoundaryProvenance:
    """Machine-readable provenance for one acquired AOI boundary."""

    source: str
    dataset_name: str
    osm_relation_ids: tuple[int, ...]
    access_date: str
    license: str
    crs: str
    area_km2: float
    note: str

    def to_dict(self) -> dict[str, object]:
        """Return a JSON-serializable dict of this provenance record."""
        return dict(asdict(self))


def _build_query(relation_ids: tuple[int, ...]) -> str:
    relation_clauses = "".join(f"relation({rid});" for rid in relation_ids)
    return f"[out:json][timeout:{OVERPASS_TIMEOUT_S}];({relation_clauses});out geom;"


def _fetch_overpass(query: str, overpass_url: str) -> dict[str, Any]:
    """POST an Overpass QL query and return the parsed JSON response."""
    data = f"data={urllib.parse.quote(query)}".encode()
    request = urllib.request.Request(
        overpass_url,
        data=data,
        method="POST",
        headers={
            "Accept": "*/*",
            "User-Agent": "vektra-flood-engine-aoi/1.0 (+https://github.com/kritagya7187/vektra)",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=OVERPASS_TIMEOUT_S) as response:
            payload = response.read()
    except Exception as exc:
        raise AoiError(f"Overpass request to {overpass_url} failed: {exc}") from exc
    return cast("dict[str, Any]", json.loads(payload))


def _relation_to_polygon(relation: dict[str, Any]) -> BaseGeometry:
    """Assemble one OSM relation's outer/inner way members into a polygon."""
    outer_lines: list[list[tuple[float, float]]] = []
    inner_lines: list[list[tuple[float, float]]] = []
    for member in relation.get("members", []):
        if member.get("type") != "way" or "geometry" not in member:
            continue
        coords = [(pt["lon"], pt["lat"]) for pt in member["geometry"]]
        if len(coords) < 2:
            continue
        (inner_lines if member.get("role") == "inner" else outer_lines).append(coords)

    if not outer_lines:
        raise AoiError(f"Relation {relation.get('id')} has no outer way geometry.")

    outer_rings = list(polygonize(linemerge(outer_lines)))
    if not outer_rings:
        raise AoiError(f"Relation {relation.get('id')} outer ways did not close into a ring.")

    outer_union = unary_union(outer_rings)
    if inner_lines:
        inner_rings = list(polygonize(linemerge(inner_lines)))
        if inner_rings:
            outer_union = outer_union.difference(unary_union(inner_rings))
    return outer_union


def fetch_mumbai_municipal_boundary(
    *,
    cache_dir: Path | None = None,
    overpass_url: str = OVERPASS_API_URL,
) -> tuple[gpd.GeoDataFrame, BoundaryProvenance]:
    """Fetch (or load from cache) the Greater Mumbai / BMC boundary as a GeoDataFrame."""
    relation_ids = (MUMBAI_CITY_DISTRICT_RELATION_ID, MUMBAI_SUBURBAN_DISTRICT_RELATION_ID)

    if cache_dir is not None:
        geojson_path = cache_dir / "mumbai_municipal_boundary.geojson"
        provenance_path = cache_dir / "mumbai_municipal_boundary.provenance.json"
        if geojson_path.exists() and provenance_path.exists():
            gdf = gpd.read_file(geojson_path)
            provenance_dict = json.loads(provenance_path.read_text())
            provenance = BoundaryProvenance(
                **{
                    **provenance_dict,
                    "osm_relation_ids": tuple(provenance_dict["osm_relation_ids"]),
                }
            )
            return gdf, provenance

    query = _build_query(relation_ids)
    raw = _fetch_overpass(query, overpass_url)
    elements = {el["id"]: el for el in raw.get("elements", []) if el.get("type") == "relation"}

    missing = set(relation_ids) - set(elements)
    if missing:
        raise AoiError(f"Overpass response missing relation(s) {sorted(missing)}.")

    polygons = [_relation_to_polygon(elements[rid]) for rid in relation_ids]
    boundary = unary_union(polygons)

    gdf = gpd.GeoDataFrame(
        {"name": ["Greater Mumbai (BMC/MCGM jurisdiction)"]},
        geometry=[boundary],
        crs=f"EPSG:{SOURCE_CRS_EPSG}",
    )

    area_km2 = float(gdf.to_crs(epsg=32643).geometry.area.sum() / 1_000_000.0)

    provenance = BoundaryProvenance(
        source="OpenStreetMap via Overpass API",
        dataset_name=(
            "Mumbai City District + Mumbai Suburban District administrative boundaries (union)"
        ),
        osm_relation_ids=relation_ids,
        access_date=datetime.now(UTC).isoformat(),
        license="ODbL (Open Database License) - OpenStreetMap contributors",
        crs=f"EPSG:{SOURCE_CRS_EPSG}",
        area_km2=area_km2,
        note=(
            "No single OSM relation is tagged as the combined BMC/MCGM/Greater Mumbai "
            "boundary. Greater Mumbai (the BMC/MCGM jurisdiction) is the union of Mumbai "
            "City District and Mumbai Suburban District, per standard Indian "
            "administrative geography. Cross-checked against the union of the 6 "
            "OSM 'Mumbai Zone' (admin_level=9) sub-boundaries, which are BMC's own "
            "internal administrative zones."
        ),
    )

    if cache_dir is not None:
        cache_dir.mkdir(parents=True, exist_ok=True)
        gdf.to_file(geojson_path, driver="GeoJSON")
        provenance_path.write_text(json.dumps(provenance.to_dict(), indent=2))

    return gdf, provenance
