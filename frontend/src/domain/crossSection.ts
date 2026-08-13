import { haversineMeters } from './geo';
import type { LonLat } from './measurement';

export interface ProfileSample {
  readonly distanceM: number;
  readonly elevationM: number | null;
  readonly depthM: number | null;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function pointAlong(points: readonly LonLat[], segmentLengths: readonly number[], targetM: number): LonLat {
  let travelled = 0;
  for (let i = 0; i < segmentLengths.length; i += 1) {
    const segmentLength = segmentLengths[i];
    if (targetM <= travelled + segmentLength || i === segmentLengths.length - 1) {
      const t = segmentLength === 0 ? 0 : (targetM - travelled) / segmentLength;
      const [lonA, latA] = points[i];
      const [lonB, latB] = points[i + 1];
      return [lerp(lonA, lonB, t), lerp(latA, latB, t)];
    }
    travelled += segmentLength;
  }
  return points[points.length - 1];
}

export function sampleProfile(
  points: readonly LonLat[],
  sampleCount: number,
  elevationAt: (lon: number, lat: number) => number | null,
  depthAt: ((lon: number, lat: number) => number | null) | null,
): ProfileSample[] {
  if (points.length < 2 || sampleCount < 2) {
    return [];
  }
  const segmentLengths = points.slice(1).map((point, i) => {
    const [lonA, latA] = points[i];
    const [lonB, latB] = point;
    return haversineMeters(latA, lonA, latB, lonB);
  });
  const totalM = segmentLengths.reduce((sum, length) => sum + length, 0);
  const samples: ProfileSample[] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const distanceM = (totalM * i) / (sampleCount - 1);
    const [lon, lat] = pointAlong(points, segmentLengths, distanceM);
    samples.push({
      distanceM,
      elevationM: elevationAt(lon, lat),
      depthM: depthAt ? depthAt(lon, lat) : null,
    });
  }
  return samples;
}
