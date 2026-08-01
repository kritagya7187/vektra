import type { SimulationRunStatus } from '../types';

/**
 * Caller-supplied parameters for one Heat Exposure Engine run. Every
 * field is optional with a documented default/behavior — nothing is
 * silently guessed without being logged and recorded via
 * simulation_run_input_dataset (EDD Section 17: "explicit... never
 * latest implicitly" — see this subsystem's engineering review for why
 * a logged, recorded default satisfies that, rather than requiring a
 * caller to hand-type a UUID every run).
 */
export interface HeatExposureSimulationInput {
  /** Pins the exact OSM building batch to use. Defaults to the most recently retrieved osm_overpass DataProvenanceRecord. */
  readonly osmProvenanceId?: string;
  /** Pins the exact Open-Meteo batch to use. Defaults to the most recently retrieved open_meteo DataProvenanceRecord. Ignored if meteorologicalVariableName is not given. */
  readonly meteorologicalProvenanceId?: string;
  /** Which Open-Meteo variable (e.g. "temperature_2m") the meteorological_context factor reports. Omitting this marks that factor not computable for the whole run — never silently defaulted to a specific variable. */
  readonly meteorologicalVariableName?: string;
  /**
   * Phase 3 Milestone 2 (Remote Sensing Foundation). Pins the exact
   * Sentinel-2/ESA WorldCover/Landsat raster asset batch to use for
   * vegetation_land_cover / thermal_signature. Unlike osmProvenanceId,
   * these have no fallback-to-"most recent" default failure mode that
   * blocks the run — if omitted (or nothing has been ingested for that
   * source yet), the corresponding factor is simply marked not
   * computable, exactly like meteorological_context when no variable
   * name is given.
   */
  readonly sentinel2ProvenanceId?: string;
  readonly worldCoverProvenanceId?: string;
  readonly landsatProvenanceId?: string;
  /** Overrides the default configuration_version tag. */
  readonly configurationVersion?: string;
}

export interface HeatExposureSimulationSummary {
  readonly runId: string;
  readonly status: SimulationRunStatus;
  readonly buildingCount: number;
  readonly resultCount: number;
  readonly inputDatasetProvenanceIds: readonly string[];
  readonly durationMs: number;
}

/**
 * Caller-supplied parameters for one Scenario Simulation Engine
 * execution. Unlike HeatExposureSimulationInput, there is no
 * osm/met-provenance pinning here — a scenario run always reuses the
 * exact input dataset versions its baseline run already recorded (EDD
 * Section 11: "applies overlay on top of the referenced baseline
 * snapshot"), never independently resolved.
 */
export interface ScenarioSimulationInput {
  readonly scenarioId: string;
  /** Which Open-Meteo variable meteorological_context reports, same meaning as HeatExposureSimulationInput's field. Ignored if the baseline run has no recorded Open-Meteo input dataset. */
  readonly meteorologicalVariableName?: string;
}

export interface ScenarioSimulationSummary {
  readonly scenarioId: string;
  readonly runId: string;
  readonly baselineRunId: string;
  readonly status: SimulationRunStatus;
  readonly buildingCount: number;
  readonly resultCount: number;
  readonly inputDatasetProvenanceIds: readonly string[];
  readonly overrideCount: number;
  readonly buildingsWithOverridesCount: number;
  readonly durationMs: number;
}
