export {
  HeatExposureSimulationService,
  heatExposureSimulationService,
  SIMULATION_ENGINE_CODE_VERSION,
  DEFAULT_CONFIGURATION_VERSION,
} from './HeatExposureSimulationService';
export type { HeatExposureSimulationServiceDependencies } from './HeatExposureSimulationService';
export type {
  HeatExposureSimulationInput,
  HeatExposureSimulationSummary,
  ScenarioSimulationInput,
  ScenarioSimulationSummary,
} from './types';
export { computeFactor, computeMeteorologicalContextFactor } from './factors';
export type { FactorComputation, MeteorologicalReading } from './factors';
export { persistHeatExposureResults } from './persistResults';
export type { PersistHeatExposureResultsDeps } from './persistResults';
export { resolveEffectiveAttributes } from './scenarioOverrides';
export { ScenarioSimulationService, scenarioSimulationService } from './ScenarioSimulationService';
export type { ScenarioSimulationServiceDependencies } from './ScenarioSimulationService';
