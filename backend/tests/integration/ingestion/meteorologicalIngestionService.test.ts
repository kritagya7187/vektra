import { describe, expect, it } from 'vitest';
import { database } from '../../../src/database';
import { ConflictError } from '../../../src/errors';
import { MeteorologicalIngestionService } from '../../../src/ingestion/remoteSensing/MeteorologicalIngestionService';
import type {
  MeteorologicalObservationClient,
  MeteorologicalObservationValue,
} from '../../../src/ingestion/remoteSensing/types';
import { meteorologicalObservationRepository } from '../../../src/repositories';
import type { MeteorologicalObservationRepository } from '../../../src/types';

/**
 * Real database, REAL repository/service/transaction layers — only the
 * HTTP-fetching client is stubbed. A genuine end-to-end run against the
 * real, public, unauthenticated Open-Meteo archive API was performed
 * once, manually — see the engineering review for that result.
 */
function fakeOpenMeteoClient(
  values: readonly MeteorologicalObservationValue[],
): MeteorologicalObservationClient {
  return { sourceCode: 'open_meteo', fetchObservations: () => Promise.resolve(values) };
}

const OBSERVATION_A: MeteorologicalObservationValue = {
  timestamp: new Date('2025-01-01T00:00:00Z'),
  variableName: 'temperature_2m',
  variableValue: 24.5,
  variableUnit: '°C',
};

const OBSERVATION_B: MeteorologicalObservationValue = {
  timestamp: new Date('2025-01-01T01:00:00Z'),
  variableName: 'temperature_2m',
  variableValue: 24.1,
  variableUnit: '°C',
};

const query = {
  latitude: 18.925,
  longitude: 72.8317,
  from: new Date('2025-01-01T00:00:00Z'),
  to: new Date('2025-01-02T00:00:00Z'),
  variables: ['temperature_2m'],
};

describe('MeteorologicalIngestionService (real DB, stubbed Open-Meteo client)', () => {
  it('creates ONE shared DataProvenanceRecord and inserts every observation through the repository layer', async () => {
    const service = new MeteorologicalIngestionService(
      fakeOpenMeteoClient([OBSERVATION_A, OBSERVATION_B]),
    );

    const summary = await service.ingest(query);

    expect(summary.totalObservationsReturned).toBe(2);
    expect(summary.insertedCount).toBe(2);
    expect(summary.skippedCount).toBe(0);

    const observations = (await meteorologicalObservationRepository.list({ limit: 10 })).filter(
      (o) => o.provenanceId === summary.provenanceId,
    );
    expect(observations).toHaveLength(2);
    expect(observations.every((o) => o.location.coordinates[0] === query.longitude)).toBe(true);
    expect(observations.every((o) => o.location.coordinates[1] === query.latitude)).toBe(true);

    const provenance = await database.query<{ source_code: string; license: string }>(
      'SELECT source_code, license FROM data_provenance_record WHERE provenance_id = $1',
      [summary.provenanceId],
    );
    expect(provenance.rows[0]?.source_code).toBe('open_meteo');
    expect(provenance.rows[0]?.license).toContain('CC BY 4.0');
  });

  it('isolates a per-observation insert failure via SAVEPOINT — the shared provenance record and other observations still commit', async () => {
    let callCount = 0;
    const flakyObservationRepository: MeteorologicalObservationRepository = {
      findById: meteorologicalObservationRepository.findById.bind(
        meteorologicalObservationRepository,
      ),
      list: meteorologicalObservationRepository.list.bind(meteorologicalObservationRepository),
      create: async (input, executor) => {
        callCount += 1;
        if (input.variableValue === OBSERVATION_B.variableValue) {
          throw new ConflictError('simulated per-row failure');
        }
        return meteorologicalObservationRepository.create(input, executor);
      },
    };

    const service = new MeteorologicalIngestionService(
      fakeOpenMeteoClient([OBSERVATION_A, OBSERVATION_B]),
      { meteorologicalObservationRepository: flakyObservationRepository },
    );

    const summary = await service.ingest(query);

    expect(callCount).toBe(2);
    expect(summary.insertedCount).toBe(1);
    expect(summary.skipped).toEqual([
      {
        timestamp: OBSERVATION_B.timestamp.toISOString(),
        variableName: OBSERVATION_B.variableName,
        reason: 'simulated per-row failure',
      },
    ]);

    // Unlike raster ingestion's per-scene provenance, this provenance
    // record is SHARED across the whole run — it still exists even
    // though one observation failed, because provenance creation
    // happens ONCE, before the per-row savepoint loop, not inside it.
    const provenance = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM data_provenance_record WHERE provenance_id = $1',
      [summary.provenanceId],
    );
    expect(provenance.rows[0]?.count).toBe('1');

    const observations = await meteorologicalObservationRepository.list({ limit: 10 });
    expect(
      observations.some(
        (o) =>
          o.provenanceId === summary.provenanceId &&
          o.variableValue === OBSERVATION_A.variableValue,
      ),
    ).toBe(true);
  });

  it('rolls back the ENTIRE transaction (including the provenance record) on a genuine upstream failure', async () => {
    const failingProvenanceRepository = {
      create: () => Promise.reject(new Error('simulated infrastructure failure')),
      findById: () => Promise.resolve(null),
      list: () => Promise.resolve([]),
    };

    const service = new MeteorologicalIngestionService(fakeOpenMeteoClient([OBSERVATION_A]), {
      dataProvenanceRecordRepository: failingProvenanceRepository,
    });

    const before = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM data_provenance_record',
    );

    await expect(service.ingest(query)).rejects.toThrow();

    const after = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM data_provenance_record',
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });
});
