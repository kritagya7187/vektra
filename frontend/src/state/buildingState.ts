import {
  ApiError,
  fetchAllBuildingsGeoJson,
  getBuilding,
  getHeatExposureResultFactors,
  listHeatExposureFactorsForRun,
  listHeatExposureResultsForRun,
  type Building,
  type BuildingGeoJsonProperties,
  type GeoJsonFeatureCollection,
  type HeatExposureFactorValue,
  type HeatExposureResult,
  type SimulationRun,
} from '../api';
import { joinBuildingsWithResults, type TwinBuilding } from '../domain/joinBuildingsWithResults';
import { AsyncStatus, Store } from './store';

/**
 * Cached separately from the store (not itself reactive state) —
 * building geometry does not change based on which result set is
 * currently styling the scene, so Comparison Mode's baseline/scenario
 * toggle (§5D) can re-join against it without a redundant network
 * fetch (design review §14: reuse data, keep rendering smooth).
 */
let cachedFeatureCollection: GeoJsonFeatureCollection<BuildingGeoJsonProperties> | null = null;

/**
 * Building state (design review §8): the joined twin dataset that drives
 * the scene (§7's client-side join, since no backend endpoint scopes
 * buildings to a run), plus the currently-selected building's cascading
 * detail (full attributes -> factor breakdown), matching the exact
 * "Click building -> Inspection panel -> Factor breakdown" flow (§4).
 * Provenance detail is intentionally NOT part of this store — it is a
 * leaf, on-demand lookup the Provenance Inspector panel owns locally
 * (still only ever calling the API layer, never bypassing it); centering
 * every fetch in one of the five domains would force unrelated panels to
 * re-render on a fetch only one of them cares about.
 */
export interface SelectionDetail {
  readonly status: AsyncStatus;
  readonly building: Building | null;
  readonly factors: readonly HeatExposureFactorValue[];
  readonly error: ApiError | null;
}

export interface BuildingState {
  readonly twinStatus: AsyncStatus;
  readonly twinBuildings: readonly TwinBuilding[];
  readonly twinError: ApiError | null;
  readonly selectedBuildingId: string | null;
  readonly selection: SelectionDetail;
}

const initialSelection: SelectionDetail = {
  status: 'idle',
  building: null,
  factors: [],
  error: null,
};

const initialState: BuildingState = {
  twinStatus: 'idle',
  twinBuildings: [],
  twinError: null,
  selectedBuildingId: null,
  selection: initialSelection,
};

export const buildingStore = new Store<BuildingState>(initialState);

function toApiError(err: unknown, fallbackMessage: string): ApiError {
  return err instanceof ApiError
    ? err
    : new ApiError({ code: 'UNKNOWN_ERROR', message: fallbackMessage, status: null, cause: err });
}

/**
 * Design review §5A / §7: fetch results for the active run (defines the
 * run-scoped building-id set) and the full building GeoJSON (every
 * batch), then join client-side. If the run has zero results (a
 * genuinely empty but valid state, not an error), twinBuildings is an
 * empty array — the scene must render an honest empty state, not throw.
 *
 * Also fetches every factor row for the run in the same batch
 * (listHeatExposureFactorsForRun, visualization redesign) — this is
 * what makes scene-wide Thermal/NDVI coloring possible without one HTTP
 * request per building; joinBuildingsWithResults does the same
 * client-side id-matching it already did for results.
 */
export async function loadTwinForRun(run: SimulationRun): Promise<void> {
  buildingStore.set((previous) => ({ ...previous, twinStatus: 'loading', twinError: null }));
  try {
    const [results, factors, featureCollection] = await Promise.all([
      listHeatExposureResultsForRun(run.runId),
      listHeatExposureFactorsForRun(run.runId),
      cachedFeatureCollection
        ? Promise.resolve(cachedFeatureCollection)
        : fetchAllBuildingsGeoJson(),
    ]);
    cachedFeatureCollection = featureCollection;
    const twinBuildings = joinBuildingsWithResults(featureCollection, results, factors);
    buildingStore.set((previous) => ({
      ...previous,
      twinStatus: 'loaded',
      twinBuildings,
      twinError: null,
    }));
  } catch (err) {
    const apiError = toApiError(err, 'Failed to load building geometry and results.');
    buildingStore.set((previous) => ({
      ...previous,
      twinStatus: 'error',
      twinBuildings: [],
      twinError: apiError,
    }));
    throw apiError;
  }
}

/** Click building -> Inspection panel -> (on expand) Factor breakdown — the factor fetch is issued eagerly here rather than deferred to expansion, since it is cheap (one small request) and removes a second loading flicker inside the already-open panel. */
export async function selectBuilding(buildingId: string): Promise<void> {
  buildingStore.set((previous) => ({
    ...previous,
    selectedBuildingId: buildingId,
    selection: { ...initialSelection, status: 'loading' },
  }));

  const twinEntry = buildingStore
    .get()
    .twinBuildings.find((tb) => tb.building.buildingId === buildingId);

  try {
    const [building, factors] = await Promise.all([
      getBuilding(buildingId),
      twinEntry ? getHeatExposureResultFactors(twinEntry.result.resultId) : Promise.resolve([]),
    ]);
    buildingStore.set((previous) => ({
      ...previous,
      selection: { status: 'loaded', building, factors, error: null },
    }));
  } catch (err) {
    const apiError = toApiError(err, 'Failed to load building detail.');
    buildingStore.set((previous) => ({
      ...previous,
      selection: { status: 'error', building: null, factors: [], error: apiError },
    }));
  }
}

export function clearSelection(): void {
  buildingStore.set((previous) => ({
    ...previous,
    selectedBuildingId: null,
    selection: initialSelection,
  }));
}

/**
 * Design review §5D / §6: re-joins the already-fetched building geometry
 * against a different result set (a scenario's comparison results)
 * without any new network call — the synchronous counterpart to
 * loadTwinForRun(), used only for the Comparison Mode styling toggle.
 * Returns an empty array if the base geometry has not been fetched yet
 * (defensive; main.ts only offers this toggle once a twin is loaded).
 */
export function deriveTwinBuildingsForResults(
  results: readonly HeatExposureResult[],
): readonly TwinBuilding[] {
  if (!cachedFeatureCollection) {
    return [];
  }
  return joinBuildingsWithResults(cachedFeatureCollection, results);
}
