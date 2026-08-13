import { ApiError, fetchAllBuildingsGeoJson, getBuilding, type Building } from '../api';
import { toTwinBuildings, type TwinBuilding } from '../domain/twinBuildings';
import { AsyncStatus, Store } from './store';
export interface SelectionDetail {
  readonly status: AsyncStatus;
  readonly building: Building | null;
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
export async function loadTwinBuildings(): Promise<void> {
  buildingStore.set((previous) => ({ ...previous, twinStatus: 'loading', twinError: null }));
  try {
    const featureCollection = await fetchAllBuildingsGeoJson();
    const twinBuildings = toTwinBuildings(featureCollection);
    buildingStore.set((previous) => ({
      ...previous,
      twinStatus: 'loaded',
      twinBuildings,
      twinError: null,
    }));
  } catch (err) {
    const apiError = toApiError(err, 'Failed to load building geometry.');
    buildingStore.set((previous) => ({
      ...previous,
      twinStatus: 'error',
      twinBuildings: [],
      twinError: apiError,
    }));
    throw apiError;
  }
}
export async function selectBuilding(buildingId: string): Promise<void> {
  buildingStore.set((previous) => ({
    ...previous,
    selectedBuildingId: buildingId,
    selection: { ...initialSelection, status: 'loading' },
  }));
  try {
    const building = await getBuilding(buildingId);
    buildingStore.set((previous) => ({
      ...previous,
      selection: { status: 'loaded', building, error: null },
    }));
  } catch (err) {
    const apiError = toApiError(err, 'Failed to load building detail.');
    buildingStore.set((previous) => ({
      ...previous,
      selection: { status: 'error', building: null, error: apiError },
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
