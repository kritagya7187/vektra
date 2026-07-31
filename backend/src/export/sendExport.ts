import type { Response } from 'express';
import type { GeoJsonFeatureCollection } from './geojson';

/**
 * Explicit Content-Type/Content-Disposition rather than
 * res.attachment(filename) — Express infers Content-Type from the
 * filename extension via a mime-db lookup, which isn't reliably correct
 * for ".geojson" across mime-db versions. Setting both explicitly is
 * deterministic and directly matches "Correct MIME types" / "Correct
 * headers" in this subsystem's verification requirements.
 */

export function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}

/**
 * application/geo+json is RFC 7946 §12's registered media type — not
 * generic application/json, which would be a weaker/less-correct claim
 * for a FeatureCollection response.
 */
export function sendGeoJson<TProperties>(
  res: Response,
  filename: string,
  featureCollection: GeoJsonFeatureCollection<TProperties>,
): void {
  res.setHeader('Content-Type', 'application/geo+json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).json(featureCollection);
}
