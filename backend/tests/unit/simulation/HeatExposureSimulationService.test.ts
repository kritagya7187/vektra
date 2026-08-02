import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../src/database';
import { ConflictError, ValidationError } from '../../../src/errors';
import { HeatExposureSimulationService } from '../../../src/simulation/HeatExposureSimulationService';
import type {
  Building,
  DataProvenanceRecord,
  MeteorologicalObservation,
  SimulationRun,
} from '../../../src/models';
import type {
  BuildingRepository,
  DataProvenanceRecordRepository,
  HeatExposureFactorValueRepository,
  HeatExposureResultRepository,
  MeteorologicalObservationRepository,
  SimulationRunInputDatasetRepository,
  SimulationRunRepository,
} from '../../../src/types';

const silentLogger = pino({ level: 'silent' });

const OSM_PROVENANCE: DataProvenanceRecord = {
  provenanceId: 'prov-osm-1',
  sourceCode: 'osm_overpass',
  sourceProductIdentifier: 'bbox:72.8,18.9,72.9,19.0',
  retrievalTimestamp: new Date('2025-01-01T00:00:00Z'),
  license: 'ODbL',
  ingestionPipelineVersion: '1.0.0',
  checksum: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MET_PROVENANCE: DataProvenanceRecord = {
  ...OSM_PROVENANCE,
  provenanceId: 'prov-met-1',
  sourceCode: 'open_meteo',
};

const BUILDING_A: Building = {
  buildingId: 'building-a',
  osmId: 1,
  osmType: 'way',
  buildingTagType: 'house',
  name: null,
  heightM: null,
  buildingLevels: null,
  geomWgs84: { type: 'MultiPolygon', coordinates: [] },
  geomUtm43n: null,
  footprintAreaSqm: 100,
  provenanceId: 'prov-osm-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const BUILDING_B: Building = {
  ...BUILDING_A,
  buildingId: 'building-b',
  osmId: 2,
  footprintAreaSqm: 200,
};

const OBSERVATION: MeteorologicalObservation = {
  metObservationId: 'obs-1',
  sourceCode: 'open_meteo',
  observationTimestamp: new Date('2025-06-01T12:00:00Z'),
  location: { type: 'Point', coordinates: [72.83, 18.92] },
  variableName: 'temperature_2m',
  variableValue: 31.4,
  variableUnit: '°C',
  provenanceId: 'prov-met-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function fakeDatabase(): Database {
  return {
    query: vi.fn(() => Promise.resolve({ rows: [], rowCount: 0 })),
    withClient: vi.fn(),
    withTransaction: vi.fn(async (fn: (tx: Database) => Promise<unknown>) => fn(fakeDb)),
  } as unknown as Database;
}
// eslint-disable-next-line prefer-const -- self-referential fake used by withTransaction above
let fakeDb: Database = fakeDatabase();

function fakeDataProvenanceRecordRepository(
  records: readonly DataProvenanceRecord[],
): DataProvenanceRecordRepository {
  return {
    findById: (id: string) => Promise.resolve(records.find((r) => r.provenanceId === id) ?? null),
    findLatestBySourceCode: (sourceCode: string) =>
      Promise.resolve(records.find((r) => r.sourceCode === sourceCode) ?? null),
    list: () => Promise.resolve(records),
    create: () => Promise.reject(new Error('not implemented in this fake')),
  };
}

function fakeBuildingRepository(buildings: readonly Building[]): BuildingRepository {
  return {
    findById: (id: string) => Promise.resolve(buildings.find((b) => b.buildingId === id) ?? null),
    list: () => Promise.resolve(buildings),
    listByProvenanceId: (provenanceId: string) =>
      Promise.resolve(buildings.filter((b) => b.provenanceId === provenanceId)),
    create: () => Promise.reject(new Error('not implemented in this fake')),
  };
}

function fakeMeteorologicalObservationRepository(
  observations: readonly MeteorologicalObservation[],
): MeteorologicalObservationRepository {
  return {
    findById: (id: string) =>
      Promise.resolve(observations.find((o) => o.metObservationId === id) ?? null),
    list: () => Promise.resolve(observations),
    findLatestByProvenanceAndVariable: (provenanceId: string, variableName: string) =>
      Promise.resolve(
        observations.find(
          (o) => o.provenanceId === provenanceId && o.variableName === variableName,
        ) ?? null,
      ),
    create: () => Promise.reject(new Error('not implemented in this fake')),
  };
}

function fakeSimulationRunRepository(): {
  repo: SimulationRunRepository;
  runs: SimulationRun[];
} {
  const runs: SimulationRun[] = [];
  let counter = 0;
  const repo: SimulationRunRepository = {
    findById: (id: string) => Promise.resolve(runs.find((r) => r.runId === id) ?? null),
    list: () => Promise.resolve(runs),
    findLatestBaselineRun: () => Promise.resolve(null),
    create: (input) => {
      counter += 1;
      const run: SimulationRun = {
        runId: `run-${counter}`,
        codeVersion: input.codeVersion,
        configurationVersion: input.configurationVersion,
        runType: input.runType,
        baselineRunId: input.baselineRunId ?? null,
        status: 'pending',
        startedAt: null,
        completedAt: null,
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      runs.push(run);
      return Promise.resolve(run);
    },
    updateStatus: (runId, update) => {
      const index = runs.findIndex((r) => r.runId === runId);
      if (index === -1) {
        return Promise.reject(new Error('run not found'));
      }
      const updated: SimulationRun = {
        ...runs[index],
        status: update.status,
        startedAt: update.startedAt ?? runs[index].startedAt,
        completedAt: update.completedAt ?? runs[index].completedAt,
        errorMessage: update.errorMessage ?? runs[index].errorMessage,
      };
      runs[index] = updated;
      return Promise.resolve(updated);
    },
  };
  return { repo, runs };
}

function fakeSimulationRunInputDatasetRepository(): {
  repo: SimulationRunInputDatasetRepository;
  created: { runId: string; provenanceId: string }[];
} {
  const created: { runId: string; provenanceId: string }[] = [];
  const repo: SimulationRunInputDatasetRepository = {
    listByRunId: () => Promise.resolve([]),
    create: (input) => {
      created.push({ runId: input.runId, provenanceId: input.provenanceId });
      return Promise.resolve({ ...input, createdAt: new Date(), updatedAt: new Date() });
    },
  };
  return { repo, created };
}

function fakeHeatExposureResultRepository(): {
  repo: HeatExposureResultRepository;
  created: { runId: string; buildingId: string }[];
} {
  const created: { runId: string; buildingId: string }[] = [];
  let counter = 0;
  const repo: HeatExposureResultRepository = {
    findById: () => Promise.resolve(null),
    list: () => Promise.resolve([]),
    listByRunId: () => Promise.resolve([]),
    create: (input) => {
      counter += 1;
      created.push({ runId: input.runId, buildingId: input.buildingId });
      return Promise.resolve({
        resultId: `result-${counter}`,
        runId: input.runId,
        buildingId: input.buildingId,
        indexValue: input.indexValue ?? null,
        computedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    },
  };
  return { repo, created };
}

function fakeHeatExposureFactorValueRepository(): {
  repo: HeatExposureFactorValueRepository;
  created: {
    resultId: string;
    factorKey: string;
    isComputable: boolean;
    factorValue: number | null;
  }[];
} {
  const created: {
    resultId: string;
    factorKey: string;
    isComputable: boolean;
    factorValue: number | null;
  }[] = [];
  let counter = 0;
  const repo: HeatExposureFactorValueRepository = {
    listByResultId: () => Promise.resolve([]),
    listByRunId: () => Promise.resolve([]),
    create: (input) => {
      counter += 1;
      created.push({
        resultId: input.resultId,
        factorKey: input.factorKey,
        isComputable: input.isComputable,
        factorValue: input.factorValue ?? null,
      });
      return Promise.resolve({
        factorValueId: `factor-${counter}`,
        resultId: input.resultId,
        factorKey: input.factorKey,
        factorValue: input.factorValue ?? null,
        isComputable: input.isComputable,
        notes: input.notes ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    },
  };
  return { repo, created };
}

function buildService(
  overrides: {
    provenanceRecords?: readonly DataProvenanceRecord[];
    buildings?: readonly Building[];
    observations?: readonly MeteorologicalObservation[];
    heatExposureResultRepository?: HeatExposureResultRepository;
  } = {},
) {
  const provenanceRepo = fakeDataProvenanceRecordRepository(
    overrides.provenanceRecords ?? [OSM_PROVENANCE, MET_PROVENANCE],
  );
  const buildingRepo = fakeBuildingRepository(overrides.buildings ?? [BUILDING_A, BUILDING_B]);
  const metRepo = fakeMeteorologicalObservationRepository(overrides.observations ?? [OBSERVATION]);
  const { repo: simulationRunRepo, runs } = fakeSimulationRunRepository();
  const { repo: inputDatasetRepo, created: inputDatasets } =
    fakeSimulationRunInputDatasetRepository();
  const { repo: resultRepo, created: results } =
    overrides.heatExposureResultRepository !== undefined
      ? {
          repo: overrides.heatExposureResultRepository,
          created: [] as { runId: string; buildingId: string }[],
        }
      : fakeHeatExposureResultRepository();
  const { repo: factorRepo, created: factors } = fakeHeatExposureFactorValueRepository();

  const service = new HeatExposureSimulationService({
    dataProvenanceRecordRepository: provenanceRepo,
    buildingRepository: buildingRepo,
    meteorologicalObservationRepository: metRepo,
    simulationRunRepository: simulationRunRepo,
    simulationRunInputDatasetRepository: inputDatasetRepo,
    heatExposureResultRepository: resultRepo,
    heatExposureFactorValueRepository: factorRepo,
    database: fakeDb,
    logger: silentLogger,
  });

  return { service, runs, inputDatasets, results, factors };
}

describe('HeatExposureSimulationService', () => {
  it('throws ValidationError when no OSM building data has been ingested', async () => {
    const { service } = buildService({ provenanceRecords: [MET_PROVENANCE] });
    await expect(service.run({})).rejects.toThrow(ValidationError);
  });

  it('rejects an explicit provenance id belonging to the wrong source', async () => {
    const { service } = buildService();
    await expect(service.run({ osmProvenanceId: MET_PROVENANCE.provenanceId })).rejects.toThrow(
      ValidationError,
    );
  });

  it('rejects an explicit provenance id that does not exist', async () => {
    const { service } = buildService();
    await expect(service.run({ osmProvenanceId: 'does-not-exist' })).rejects.toThrow(
      ValidationError,
    );
  });

  it('runs a full baseline simulation: creates the run, marks it running then completed, and records exactly the OSM provenance as an input dataset when no meteorological variable is requested', async () => {
    const { service, runs, inputDatasets, results } = buildService();

    const summary = await service.run({});

    expect(summary.status).toBe('completed');
    expect(summary.buildingCount).toBe(2);
    expect(summary.resultCount).toBe(2);
    expect(summary.inputDatasetProvenanceIds).toEqual([OSM_PROVENANCE.provenanceId]);

    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('completed');
    expect(runs[0].startedAt).not.toBeNull();
    expect(runs[0].completedAt).not.toBeNull();
    expect(runs[0].runType).toBe('baseline');

    expect(inputDatasets).toEqual([
      { runId: runs[0].runId, provenanceId: OSM_PROVENANCE.provenanceId },
    ]);
    expect(results).toHaveLength(2);
  });

  it('creates one HeatExposureResult with exactly 5 HeatExposureFactorValue rows per building, only meteorological_context computable', async () => {
    const { service, factors } = buildService();
    await service.run({ meteorologicalVariableName: 'temperature_2m' });

    expect(factors).toHaveLength(10); // 2 buildings * 5 factors
    const computable = factors.filter((f) => f.isComputable);
    expect(computable).toHaveLength(2); // 2 buildings * 1 computable factor
    expect(new Set(computable.map((f) => f.factorKey))).toEqual(
      new Set(['meteorological_context']),
    );
    expect(computable.every((f) => f.factorValue !== null)).toBe(true);
    const notComputable = factors.filter((f) => !f.isComputable);
    expect(notComputable).toHaveLength(8); // 2 buildings * 4 not-computable factors
    expect(notComputable.every((f) => f.factorValue === null)).toBe(true);
  });

  it('records BOTH resolved provenance ids as input datasets when a meteorological variable is requested and found', async () => {
    const { service, inputDatasets, runs } = buildService();
    await service.run({ meteorologicalVariableName: 'temperature_2m' });

    expect(inputDatasets.map((d) => d.provenanceId).sort()).toEqual(
      [OSM_PROVENANCE.provenanceId, MET_PROVENANCE.provenanceId].sort(),
    );
    expect(inputDatasets.every((d) => d.runId === runs[0].runId)).toBe(true);
  });

  it('does not record the meteorological provenance as an input dataset when no observation for the requested variable exists (nothing was actually consumed)', async () => {
    const { service, inputDatasets } = buildService({ observations: [] });
    await service.run({ meteorologicalVariableName: 'temperature_2m' });

    expect(inputDatasets).toHaveLength(1);
    expect(inputDatasets[0].provenanceId).toBe(OSM_PROVENANCE.provenanceId);
  });

  it('marks the run failed with a safe error message and rethrows when persistence fails, without corrupting the run row', async () => {
    const failingResultRepository: HeatExposureResultRepository = {
      findById: () => Promise.resolve(null),
      list: () => Promise.resolve([]),
      listByRunId: () => Promise.resolve([]),
      create: () => Promise.reject(new ConflictError('simulated infrastructure failure')),
    };
    const { service, runs } = buildService({
      heatExposureResultRepository: failingResultRepository,
    });

    await expect(service.run({})).rejects.toThrow(ConflictError);

    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('failed');
    expect(runs[0].errorMessage).toBe('simulated infrastructure failure');
    expect(runs[0].completedAt).not.toBeNull();
  });

  it('is deterministic: running twice against the same fixed inputs produces the same per-building factor computations', async () => {
    const { service: serviceA, factors: factorsA } = buildService();
    const { service: serviceB, factors: factorsB } = buildService();

    await serviceA.run({ meteorologicalVariableName: 'temperature_2m' });
    await serviceB.run({ meteorologicalVariableName: 'temperature_2m' });

    const normalize = (
      list: readonly { factorKey: string; isComputable: boolean; factorValue: number | null }[],
    ) =>
      list
        .map((f) => ({
          factorKey: f.factorKey,
          isComputable: f.isComputable,
          factorValue: f.factorValue,
        }))
        .sort((a, b) => a.factorKey.localeCompare(b.factorKey));

    expect(normalize(factorsA)).toEqual(normalize(factorsB));
  });
});
