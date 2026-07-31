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
