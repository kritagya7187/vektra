import { haversineMeters } from './geo';
export type LonLat = readonly [lon: number, lat: number];

export function pathDistanceMeters(points: readonly LonLat[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [lonA, latA] = points[i - 1];
    const [lonB, latB] = points[i];
    total += haversineMeters(latA, lonA, latB, lonB);
  }
  return total;
}

/** Shoelace area on an equirectangular projection local to the ring's centroid -- accurate at measurement scale (city-sized areas, not geodesic-scale polygons). */
export function polygonAreaSqMeters(points: readonly LonLat[]): number {
  if (points.length < 3) {
    return 0;
  }
  const meanLat = points.reduce((sum, [, lat]) => sum + lat, 0) / points.length;
  const metersPerDegLat = haversineMeters(meanLat, 0, meanLat + 1, 0);
  const metersPerDegLon = haversineMeters(meanLat, 0, meanLat, 1);
  const projected = points.map(([lon, lat]) => [lon * metersPerDegLon, lat * metersPerDegLat]);
  let sum = 0;
  for (let i = 0; i < projected.length; i += 1) {
    const [xA, yA] = projected[i];
    const [xB, yB] = projected[(i + 1) % projected.length];
    sum += xA * yB - xB * yA;
  }
  return Math.abs(sum) / 2;
}
