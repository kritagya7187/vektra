import type { SubmitFloodSimulationRequest } from '../api';

/**
 * Step 20 §5 (Job Integration): per explicit project-owner decision
 * (AskUserQuestion, this step), "Submit" is a clearly-labeled demo
 * action, not a real scenario picker — no `flood_scenario`/AOI-definition
 * system exists anywhere in this project yet (frozen out of scope; see
 * flood-engine/pipeline.py's own "no AOI geometry exists anywhere in
 * this project yet" and the Step 20 plan's own disclosed-prerequisite
 * discussion). Building a real scenario-definition UI would be
 * scenario-pipeline work, not visualization.
 *
 * These paths reference `.npy` files that must already exist on the
 * flood-engine host's filesystem — this module does NOT generate them.
 * Stage them with the same helper the backend's own tests use:
 *   python backend/tests/helpers/stageFloodEngineArrays.py <output_dir>
 * pointed at DEMO_ARRAY_DIR below, as a manual/documented deployment
 * step, intentionally not automated by this frontend (generating demo
 * data is test-fixture territory, not visualization-layer scope). If
 * the files are absent, submission still succeeds (202 pending) — the
 * job then genuinely fails when the worker can't load them, which is
 * itself an honest, observable job-lifecycle outcome, not a broken demo.
 */

const DEMO_ARRAY_DIR = '/vektra-demo-data';

/** A real, plausible South Mumbai bounding box — matches backend/tests/api/floodSimulations.test.ts's own fixture convention. */
const DEMO_AOI_BOUNDS_WGS84: readonly [number, number, number, number] = [72.8, 18.9, 72.9, 19.0];

export const DEMO_FLOOD_SIMULATION_REQUEST: SubmitFloodSimulationRequest = {
  scenarioId: 'vektra-demo',
  elevationPath: `${DEMO_ARRAY_DIR}/elevation.npy`,
  buildingMaskPath: `${DEMO_ARRAY_DIR}/building_mask.npy`,
  manningNPath: `${DEMO_ARRAY_DIR}/manning_n.npy`,
  infiltrationLossPath: `${DEMO_ARRAY_DIR}/infiltration.npy`,
  rainfallRatesPath: `${DEMO_ARRAY_DIR}/rainfall.npy`,
  aoiBoundsWgs84: DEMO_AOI_BOUNDS_WGS84,
};
