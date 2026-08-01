import {
  ApiError,
  createScenario as apiCreateScenario,
  getScenario,
  getScenarioComparison,
  listScenariosPage,
  type CreateScenarioOverrideRequest,
  type Scenario,
  type ScenarioComparison,
  type ScenarioOverride,
} from '../api';
import { AsyncStatus, Store } from './store';

/**
 * Scenario state (design review §8, §5C/§5D). Editing means editing the
 * in-memory draft BEFORE submission — the backend has no endpoint to
 * modify a scenario or its overrides after creation
 * (ScenarioService.ts's own comment: "Deliberately NOT built: a method
 * to add an override to an already-created scenario"), so that is the
 * only form of "editing" this state can honestly support. There is no
 * execute/trigger action anywhere in this module — none exists in the
 * API (§16).
 */
export interface ScenarioDraft {
  readonly baselineRunId: string;
  readonly name: string;
  readonly description: string;
  readonly overrides: readonly CreateScenarioOverrideRequest[];
}

export interface ScenarioState {
  readonly listStatus: AsyncStatus;
  readonly scenarios: readonly Scenario[];
  readonly listError: ApiError | null;

  readonly draft: ScenarioDraft | null;

  readonly createStatus: AsyncStatus;
  readonly createError: ApiError | null;

  readonly activeScenario: Scenario | null;
  /** Only ever populated immediately after createScenario() resolves — the API's one-time override payload (design review §7's documented gap). Lost on reload; not re-fetchable. */
  readonly activeOverrides: readonly ScenarioOverride[];

  readonly comparisonStatus: AsyncStatus;
  readonly comparison: ScenarioComparison | null;
  readonly comparisonError: ApiError | null;
}

const initialState: ScenarioState = {
  listStatus: 'idle',
  scenarios: [],
  listError: null,
  draft: null,
  createStatus: 'idle',
  createError: null,
  activeScenario: null,
  activeOverrides: [],
  comparisonStatus: 'idle',
  comparison: null,
  comparisonError: null,
};

export const scenarioStore = new Store<ScenarioState>(initialState);

function toApiError(err: unknown, fallbackMessage: string): ApiError {
  return err instanceof ApiError
    ? err
    : new ApiError({ code: 'UNKNOWN_ERROR', message: fallbackMessage, status: null, cause: err });
}

export async function loadScenarios(limit = 50, offset = 0): Promise<void> {
  scenarioStore.set((previous) => ({ ...previous, listStatus: 'loading', listError: null }));
  try {
    const scenarios = await listScenariosPage(limit, offset);
    scenarioStore.set((previous) => ({ ...previous, listStatus: 'loaded', scenarios }));
  } catch (err) {
    const apiError = toApiError(err, 'Failed to load scenarios.');
    scenarioStore.set((previous) => ({ ...previous, listStatus: 'error', listError: apiError }));
  }
}

export function startDraft(baselineRunId: string): void {
  scenarioStore.set((previous) => ({
    ...previous,
    draft: { baselineRunId, name: '', description: '', overrides: [] },
    createStatus: 'idle',
    createError: null,
  }));
}

export function cancelDraft(): void {
  scenarioStore.set((previous) => ({
    ...previous,
    draft: null,
    createStatus: 'idle',
    createError: null,
  }));
}

export function setDraftName(name: string): void {
  scenarioStore.set((previous) =>
    previous.draft ? { ...previous, draft: { ...previous.draft, name } } : previous,
  );
}

export function setDraftDescription(description: string): void {
  scenarioStore.set((previous) =>
    previous.draft ? { ...previous, draft: { ...previous.draft, description } } : previous,
  );
}

/** No duplicate (buildingId, attributeName) pair — the same rule ScenarioService enforces server-side, checked here too so the draft never submits something guaranteed to fail. */
export function addDraftOverride(override: CreateScenarioOverrideRequest): void {
  scenarioStore.set((previous) => {
    if (!previous.draft) {
      return previous;
    }
    const isDuplicate = previous.draft.overrides.some(
      (existing) =>
        existing.buildingId === override.buildingId &&
        existing.attributeName === override.attributeName,
    );
    if (isDuplicate) {
      return previous;
    }
    return {
      ...previous,
      draft: { ...previous.draft, overrides: [...previous.draft.overrides, override] },
    };
  });
}

export function removeDraftOverride(index: number): void {
  scenarioStore.set((previous) => {
    if (!previous.draft) {
      return previous;
    }
    return {
      ...previous,
      draft: {
        ...previous.draft,
        overrides: previous.draft.overrides.filter((_, i) => i !== index),
      },
    };
  });
}

export async function submitDraft(): Promise<Scenario | null> {
  const { draft } = scenarioStore.get();
  if (!draft || draft.overrides.length === 0 || draft.name.trim().length === 0) {
    return null;
  }

  scenarioStore.set((previous) => ({ ...previous, createStatus: 'loading', createError: null }));
  try {
    const created = await apiCreateScenario({
      baselineRunId: draft.baselineRunId,
      name: draft.name.trim(),
      description: draft.description.trim().length > 0 ? draft.description.trim() : null,
      overrides: draft.overrides,
    });
    scenarioStore.set((previous) => ({
      ...previous,
      createStatus: 'loaded',
      draft: null,
      activeScenario: created.scenario,
      activeOverrides: created.overrides,
      scenarios: [created.scenario, ...previous.scenarios],
    }));
    return created.scenario;
  } catch (err) {
    const apiError = toApiError(err, 'Failed to create the scenario.');
    scenarioStore.set((previous) => ({
      ...previous,
      createStatus: 'error',
      createError: apiError,
    }));
    return null;
  }
}

/**
 * Design review §5D: comparisonResults being null is the API's own
 * documented non-error state ("scenario has not yet been executed") —
 * rendered by the Comparison View as the approved "Awaiting execution"
 * state, never as an error.
 */
export async function viewScenario(scenarioId: string): Promise<void> {
  scenarioStore.set((previous) => ({
    ...previous,
    comparisonStatus: 'loading',
    comparisonError: null,
    activeOverrides:
      previous.activeScenario?.scenarioId === scenarioId ? previous.activeOverrides : [],
  }));
  try {
    const [scenario, comparison] = await Promise.all([
      getScenario(scenarioId),
      getScenarioComparison(scenarioId),
    ]);
    scenarioStore.set((previous) => ({
      ...previous,
      activeScenario: scenario,
      comparisonStatus: 'loaded',
      comparison,
    }));
  } catch (err) {
    const apiError = toApiError(err, 'Failed to load scenario comparison.');
    scenarioStore.set((previous) => ({
      ...previous,
      comparisonStatus: 'error',
      comparisonError: apiError,
    }));
  }
}
