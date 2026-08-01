import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../src/database';
import { ConflictError, NotFoundError, ValidationError } from '../../../src/errors';
import { ScenarioSimulationService } from '../../../src/simulation/ScenarioSimulationService';
import type {
  DataProvenanceRecord,
  MeteorologicalObservation,
  Scenario,
  ScenarioOverride,
  SimulationRun,
  SimulationRunInputDataset,
} from '../../../src/models';
import type {
  BuildingRepository,
  DataProvenanceRecordRepository,
  HeatExposureFactorValueRepository,
  HeatExposureResultRepository,
  MeteorologicalObservationRepository,
  ScenarioOverrideRepository,
  ScenarioRepository,
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

const BUILDING_A = {
  buildingId: 'building-a',
  osmId: 1,
  osmType: 'way' as const,
  buildingTagType: 'house',
  name: null,
  heightM: null,
  buildingLevels: null,
  geomWgs84: { type: 'MultiPolygon' as const, coordinates: [] },
  geomUtm43n: null,
  footprintAreaSqm: 100,
  provenanceId: 'prov-osm-1',
  createdAt: new Date(),
  updatedAt: new Date(),
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

const BASELINE_RUN: SimulationRun = {
  runId: 'baseline-run-1',
  codeVersion: '1.0.0',
  configurationVersion: '1.0.0',
  runType: 'baseline',
  baselineRunId: null,
  status: 'completed',
  startedAt: new Date('2025-01-01T00:00:00Z'),
  completedAt: new Date('2025-01-01T00:01:00Z'),
  errorMessage: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const SCENARIO: Scenario = {
  scenarioId: 'scenario-1',
  baselineRunId: 'baseline-run-1',
  derivedRunId: null,
  name: 'Cool Roof Scenario',
  description: null,
  createdBy: 'test-suite',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const OVERRIDE: ScenarioOverride = {
  overrideId: 'override-1',
  scenarioId: 'scenario-1',
  buildingId: 'building-a',
  sequenceNumber: 0,
  attributeName: 'roof_albedo',
  overrideValue: '0.8',
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

function fakeBuildingRepository(buildings: readonly (typeof BUILDING_A)[]): BuildingRepository {
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

function fakeSimulationRunRepository(seed: readonly SimulationRun[]): {
  repo: SimulationRunRepository;
  runs: SimulationRun[];
} {
  const runs: SimulationRun[] = [...seed];
  let counter = 0;
  const repo: SimulationRunRepository = {
    findById: (id: string) => Promise.resolve(runs.find((r) => r.runId === id) ?? null),
    list: () => Promise.resolve(runs),
    findLatestBaselineRun: () => Promise.resolve(null),
    create: (input) => {
      counter += 1;
      const run: SimulationRun = {
        runId: `scenario-run-${counter}`,
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

function fakeSimulationRunInputDatasetRepository(seed: readonly SimulationRunInputDataset[]): {
  repo: SimulationRunInputDatasetRepository;
  created: { runId: string; provenanceId: string }[];
} {
  const created: { runId: string; provenanceId: string }[] = [];
  const repo: SimulationRunInputDatasetRepository = {
    listByRunId: (runId: string) => Promise.resolve(seed.filter((row) => row.runId === runId)),
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

function fakeScenarioRepository(seed: readonly Scenario[]): {
  repo: ScenarioRepository;
  scenarios: Scenario[];
} {
  const scenarios: Scenario[] = [...seed];
  const repo: ScenarioRepository = {
    findById: (id: string) => Promise.resolve(scenarios.find((s) => s.scenarioId === id) ?? null),
    list: () => Promise.resolve(scenarios),
    create: () => Promise.reject(new Error('not implemented in this fake')),
    updateDerivedRunId: (scenarioId: string, derivedRunId: string) => {
      const index = scenarios.findIndex((s) => s.scenarioId === scenarioId);
      if (index === -1) {
        return Promise.reject(new Error('scenario not found'));
      }
      if (scenarios[index].derivedRunId !== null) {
        return Promise.reject(new ConflictError('scenario already executed'));
      }
      scenarios[index] = { ...scenarios[index], derivedRunId };
      return Promise.resolve(scenarios[index]);
    },
  };
  return { repo, scenarios };
}

function fakeScenarioOverrideRepository(
  overrides: readonly ScenarioOverride[],
): ScenarioOverrideRepository {
  return {
    create: () => Promise.reject(new Error('not implemented in this fake')),
    listByScenarioId: (scenarioId: string) =>
      Promise.resolve(overrides.filter((o) => o.scenarioId === scenarioId)),
  };
}

function buildService(
  options: {
    scenario?: Scenario;
    baselineRun?: SimulationRun;
    baselineInputDatasets?: readonly SimulationRunInputDataset[];
    overrides?: readonly ScenarioOverride[];
    observations?: readonly MeteorologicalObservation[];
    scenarioRepository?: ScenarioRepository;
    heatExposureFactorValueRepository?: HeatExposureFactorValueRepository;
  } = {},
) {
  const scenario = options.scenario ?? SCENARIO;
  const baselineRun = options.baselineRun ?? BASELINE_RUN;
  const baselineInputDatasets = options.baselineInputDatasets ?? [
    {
      runId: baselineRun.runId,
      provenanceId: OSM_PROVENANCE.provenanceId,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const provenanceRepo = fakeDataProvenanceRecordRepository([OSM_PROVENANCE, MET_PROVENANCE]);
  const buildingRepo = fakeBuildingRepository([BUILDING_A]);
  const metRepo = fakeMeteorologicalObservationRepository(options.observations ?? [OBSERVATION]);
  const { repo: simulationRunRepo, runs } = fakeSimulationRunRepository([baselineRun]);
  const { repo: inputDatasetRepo, created: inputDatasets } =
    fakeSimulationRunInputDatasetRepository(baselineInputDatasets);
  const { repo: resultRepo, created: results } = fakeHeatExposureResultRepository();
  const { repo: factorRepo, created: factors } =
    options.heatExposureFactorValueRepository !== undefined
      ? { repo: options.heatExposureFactorValueRepository, created: [] as never[] }
      : fakeHeatExposureFactorValueRepository();
  const { repo: scenarioRepo, scenarios } =
    options.scenarioRepository !== undefined
      ? { repo: options.scenarioRepository, scenarios: [] as Scenario[] }
      : fakeScenarioRepository([scenario]);
  const overrideRepo = fakeScenarioOverrideRepository(options.overrides ?? [OVERRIDE]);

  const service = new ScenarioSimulationService({
    scenarioRepository: scenarioRepo,
    scenarioOverrideRepository: overrideRepo,
    simulationRunRepository: simulationRunRepo,
    simulationRunInputDatasetRepository: inputDatasetRepo,
    dataProvenanceRecordRepository: provenanceRepo,
    buildingRepository: buildingRepo,
    meteorologicalObservationRepository: metRepo,
    heatExposureResultRepository: resultRepo,
    heatExposureFactorValueRepository: factorRepo,
    database: fakeDb,
    logger: silentLogger,
  });

  return { service, runs, inputDatasets, results, factors, scenarios };
}

describe('ScenarioSimulationService', () => {
  it('throws NotFoundError for an unknown scenario id', async () => {
    const { service } = buildService();
    await expect(service.run({ scenarioId: 'does-not-exist' })).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError when the scenario has already been executed', async () => {
    const { service } = buildService({
      scenario: { ...SCENARIO, derivedRunId: 'some-earlier-run' },
    });
    await expect(service.run({ scenarioId: SCENARIO.scenarioId })).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when the referenced baseline run is not a baseline-type run', async () => {
    const { service } = buildService({ baselineRun: { ...BASELINE_RUN, runType: 'scenario' } });
    await expect(service.run({ scenarioId: SCENARIO.scenarioId })).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when the referenced baseline run is not completed', async () => {
    const { service } = buildService({ baselineRun: { ...BASELINE_RUN, status: 'running' } });
    await expect(service.run({ scenarioId: SCENARIO.scenarioId })).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when the baseline run has no recorded OSM input dataset', async () => {
    const { service } = buildService({ baselineInputDatasets: [] });
    await expect(service.run({ scenarioId: SCENARIO.scenarioId })).rejects.toThrow(ValidationError);
  });

  it('executes successfully: creates a scenario-type run referencing the baseline, records the OSM provenance, and sets derived_run_id', async () => {
    const { service, runs, inputDatasets, results, scenarios } = buildService();

    const summary = await service.run({ scenarioId: SCENARIO.scenarioId });

    expect(summary.status).toBe('completed');
    expect(summary.baselineRunId).toBe(BASELINE_RUN.runId);
    expect(summary.buildingCount).toBe(1);
    expect(summary.resultCount).toBe(1);
    expect(summary.overrideCount).toBe(1);
    expect(summary.buildingsWithOverridesCount).toBe(1);
    expect(summary.inputDatasetProvenanceIds).toEqual([OSM_PROVENANCE.provenanceId]);

    const scenarioRun = runs.find((r) => r.runId === summary.runId);
    expect(scenarioRun?.runType).toBe('scenario');
    expect(scenarioRun?.baselineRunId).toBe(BASELINE_RUN.runId);
    expect(scenarioRun?.status).toBe('completed');

    expect(inputDatasets).toEqual([
      { runId: summary.runId, provenanceId: OSM_PROVENANCE.provenanceId },
    ]);
    expect(results).toEqual([{ runId: summary.runId, buildingId: BUILDING_A.buildingId }]);

    expect(scenarios[0].derivedRunId).toBe(summary.runId);
  });

  it('reuses the baseline-recorded Open-Meteo provenance (never independently resolved) when a variable is requested and an observation exists', async () => {
    const { service, inputDatasets } = buildService({
      baselineInputDatasets: [
        {
          runId: BASELINE_RUN.runId,
          provenanceId: OSM_PROVENANCE.provenanceId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          runId: BASELINE_RUN.runId,
          provenanceId: MET_PROVENANCE.provenanceId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    const summary = await service.run({
      scenarioId: SCENARIO.scenarioId,
      meteorologicalVariableName: 'temperature_2m',
    });

    expect([...summary.inputDatasetProvenanceIds].sort()).toEqual(
      [OSM_PROVENANCE.provenanceId, MET_PROVENANCE.provenanceId].sort(),
    );
    expect(inputDatasets.map((d) => d.provenanceId).sort()).toEqual(
      [OSM_PROVENANCE.provenanceId, MET_PROVENANCE.provenanceId].sort(),
    );
  });

  it('marks meteorological_context not computable (without failing the run) when a variable is requested but the baseline had no Open-Meteo input', async () => {
    const { service, factors } = buildService();

    await service.run({
      scenarioId: SCENARIO.scenarioId,
      meteorologicalVariableName: 'temperature_2m',
    });

    expect(factors.every((f) => !f.isComputable || f.factorKey === 'meteorological_context')).toBe(
      true,
    );
    const met = factors.find((f) => f.factorKey === 'meteorological_context');
    expect(met?.isComputable).toBe(false);
  });

  it('marks the run failed, does NOT set derived_run_id, and rethrows when persistence fails inside the transaction', async () => {
    const failingFactorRepository: HeatExposureFactorValueRepository = {
      listByResultId: () => Promise.resolve([]),
      create: () => Promise.reject(new ConflictError('simulated infrastructure failure')),
    };
    const { service, runs, scenarios } = buildService({
      heatExposureFactorValueRepository: failingFactorRepository,
    });

    await expect(service.run({ scenarioId: SCENARIO.scenarioId })).rejects.toThrow(ConflictError);

    const scenarioRun = runs.find((r) => r.runType === 'scenario');
    expect(scenarioRun?.status).toBe('failed');
    expect(scenarioRun?.errorMessage).toBe('simulated infrastructure failure');
    expect(scenarios[0].derivedRunId).toBeNull();
  });
});
