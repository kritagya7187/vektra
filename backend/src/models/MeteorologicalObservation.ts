import type { MeteorologicalDataSourceCode } from '../types/enums';
import type { GeoJsonPoint } from '../types/geometry';

/**
 * meteorological_observation (db/migrations/0007). MeteorologicalObservation
 * entity (EDD Section 16). One row per (location, timestamp, variable)
 * reading from Open-Meteo.
 *
 * variableValue is `number`, but the `pg` driver returns NUMERIC columns
 * as strings by default — see Building.ts's note.
 */
export interface MeteorologicalObservation {
  readonly metObservationId: string;
  readonly sourceCode: MeteorologicalDataSourceCode;
  readonly observationTimestamp: Date;
  readonly location: GeoJsonPoint;
  readonly variableName: string;
  readonly variableValue: number;
  readonly variableUnit: string;
  readonly provenanceId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
