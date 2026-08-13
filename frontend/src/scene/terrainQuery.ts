type ElevationQuery = (lon: number, lat: number) => number | null;
let elevationQuery: ElevationQuery | null = null;
export function setElevationQuery(fn: ElevationQuery): void {
  elevationQuery = fn;
}
export function queryElevation(lon: number, lat: number): number | null {
  return elevationQuery ? elevationQuery(lon, lat) : null;
}
