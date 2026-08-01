import {
  buildingStore,
  cancelDraft,
  loadScenarios,
  openPanel,
  runStore,
  scenarioStore,
  addDraftOverride,
  removeDraftOverride,
  startDraft,
  submitDraft,
  viewScenario,
} from '../state';
import { clear, h, mount } from '../utils/dom';
import { createPanelShell } from './panelShell';
import type { PanelController } from './types';

/**
 * Scenario Workspace (design review §4 item 6, §5C, FR-8): scenario
 * list + draft creation. "Editing" means editing the in-memory draft
 * before submission — the backend has no endpoint to modify a scenario
 * after creation (see state/scenarioState.ts's own note). There is no
 * execute/trigger control anywhere in this panel.
 *
 * The name/description/attribute/value inputs are created ONCE when
 * entering draft mode and never torn down by a reactive re-render —
 * only the "already-added overrides" list and the "currently selected
 * building" label are rebuilt on state change. Rebuilding a live text
 * input on every keystroke-adjacent store update would steal focus and
 * cursor position; those two fields are read directly from the DOM only
 * when the user acts (Add / Create Scenario), never mirrored into the
 * reactive store character-by-character.
 */
export function renderScenarioWorkspace(
  container: HTMLElement,
  onClose: () => void,
): PanelController {
  const shell = createPanelShell({ id: 'scenario-workspace', title: 'Scenarios', onClose });
  mount(container, shell.element);
  shell.focus();

  let mode: 'list' | 'draft' | null = null;
  let dynamicListContainer: HTMLElement | null = null;
  let selectedBuildingLabel: HTMLElement | null = null;
  let nameInput: HTMLInputElement | null = null;
  let descriptionInput: HTMLInputElement | null = null;
  let attributeInput: HTMLInputElement | null = null;
  let valueInput: HTMLInputElement | null = null;

  const renderListMode = (): void => {
    const { scenarios, listStatus } = scenarioStore.get();
    const { activeRun } = runStore.get();

    clear(shell.body);
    mount(
      shell.body,
      h(
        'button',
        {
          type: 'button',
          class: 'scenario-workspace__new',
          disabled: !activeRun,
          onClick: () => activeRun && startDraft(activeRun.runId),
        },
        'New scenario',
      ),
      !activeRun
        ? h(
            'p',
            { class: 'scenario-workspace__hint' },
            'A completed baseline run is required to define a scenario.',
          )
        : null,
      listStatus === 'loading'
        ? h('p', { role: 'status' }, 'Loading scenarios…')
        : scenarios.length === 0
          ? h('p', {}, 'No scenarios yet.')
          : h(
              'ul',
              { class: 'scenario-list' },
              ...scenarios.map((scenario) =>
                h(
                  'li',
                  { class: 'scenario-list__item' },
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'scenario-list__open',
                      onClick: () => {
                        void viewScenario(scenario.scenarioId);
                        openPanel('comparison');
                      },
                    },
                    scenario.name,
                  ),
                  h(
                    'span',
                    { class: 'scenario-list__status' },
                    scenario.derivedRunId ? 'Executed' : 'Awaiting execution',
                  ),
                ),
              ),
            ),
    );
  };

  const renderOverridesList = (): void => {
    if (!dynamicListContainer) {
      return;
    }
    clear(dynamicListContainer);
    const draft = scenarioStore.get().draft;
    if (!draft) {
      return;
    }
    if (draft.overrides.length === 0) {
      mount(
        dynamicListContainer,
        h('p', { class: 'scenario-draft__empty' }, 'No overrides added yet.'),
      );
      return;
    }
    mount(
      dynamicListContainer,
      h(
        'ul',
        { class: 'scenario-draft__overrides', 'aria-label': 'Overrides in this scenario' },
        ...draft.overrides.map((override, index) =>
          h(
            'li',
            {},
            h(
              'span',
              {},
              `${override.attributeName} = ${override.overrideValue} (building ${override.buildingId.slice(0, 8)}…)`,
            ),
            h(
              'button',
              {
                type: 'button',
                'aria-label': 'Remove override',
                onClick: () => removeDraftOverride(index),
              },
              '✕',
            ),
          ),
        ),
      ),
    );
  };

  const renderSelectedBuildingLabel = (): void => {
    if (!selectedBuildingLabel) {
      return;
    }
    const selectedId = buildingStore.get().selectedBuildingId;
    selectedBuildingLabel.textContent = selectedId
      ? `Selected building: ${selectedId.slice(0, 8)}…`
      : 'Select a building in the scene to add an override for it.';
  };

  const renderDraftMode = (): void => {
    const draft = scenarioStore.get().draft;
    if (!draft) {
      return;
    }
    const { createStatus, createError } = scenarioStore.get();

    clear(shell.body);

    nameInput = h('input', {
      type: 'text',
      placeholder: 'Scenario name',
      required: true,
    }) as HTMLInputElement;
    descriptionInput = h('input', {
      type: 'text',
      placeholder: 'Description (optional)',
    }) as HTMLInputElement;
    attributeInput = h('input', {
      type: 'text',
      placeholder: 'Attribute name (e.g. roof_albedo)',
    }) as HTMLInputElement;
    valueInput = h('input', { type: 'text', placeholder: 'Override value' }) as HTMLInputElement;
    selectedBuildingLabel = h('p', { class: 'scenario-draft__selection' });
    dynamicListContainer = h('div', { class: 'scenario-draft__list' });

    const addOverride = (): void => {
      const selectedId = buildingStore.get().selectedBuildingId;
      const attributeName = attributeInput?.value.trim() ?? '';
      const overrideValue = valueInput?.value.trim() ?? '';
      if (!selectedId || attributeName.length === 0 || overrideValue.length === 0) {
        return;
      }
      addDraftOverride({ buildingId: selectedId, attributeName, overrideValue });
      if (attributeInput) attributeInput.value = '';
      if (valueInput) valueInput.value = '';
    };

    mount(
      shell.body,
      h(
        'form',
        {
          class: 'scenario-draft',
          onSubmit: (event: Event) => event.preventDefault(),
        },
        h('label', { class: 'scenario-draft__field' }, 'Name', nameInput),
        h('label', { class: 'scenario-draft__field' }, 'Description', descriptionInput),
        h('hr'),
        selectedBuildingLabel,
        h(
          'div',
          { class: 'scenario-draft__override-entry' },
          h('label', { class: 'scenario-draft__field' }, 'Attribute', attributeInput),
          h('label', { class: 'scenario-draft__field' }, 'Value', valueInput),
          h('button', { type: 'button', onClick: addOverride }, 'Add override'),
        ),
        dynamicListContainer,
        createError
          ? h('p', { role: 'alert', class: 'scenario-draft__error' }, createError.message)
          : null,
        h(
          'div',
          { class: 'scenario-draft__actions' },
          h(
            'button',
            {
              type: 'button',
              class: 'scenario-draft__submit',
              disabled: createStatus === 'loading',
              onClick: () => {
                if (nameInput) {
                  // Committed to the store only now, on explicit submit —
                  // never on keystroke (see this file's own header note).
                  scenarioStore.set((previous) =>
                    previous.draft
                      ? {
                          ...previous,
                          draft: {
                            ...previous.draft,
                            name: nameInput?.value ?? '',
                            description: descriptionInput?.value ?? '',
                          },
                        }
                      : previous,
                  );
                }
                void submitDraft().then((created) => {
                  if (created) {
                    void viewScenario(created.scenarioId);
                    openPanel('comparison');
                  }
                });
              },
            },
            createStatus === 'loading' ? 'Creating…' : 'Create scenario',
          ),
          h(
            'button',
            { type: 'button', class: 'scenario-draft__cancel', onClick: () => cancelDraft() },
            'Cancel',
          ),
        ),
      ),
    );

    renderOverridesList();
    renderSelectedBuildingLabel();
  };

  const render = (): void => {
    const draft = scenarioStore.get().draft;
    const nextMode = draft ? 'draft' : 'list';

    if (nextMode !== mode) {
      mode = nextMode;
      if (mode === 'draft') {
        renderDraftMode();
      } else {
        dynamicListContainer = null;
        selectedBuildingLabel = null;
        renderListMode();
      }
      return;
    }

    if (mode === 'draft') {
      renderOverridesList();
      renderSelectedBuildingLabel();
    } else {
      renderListMode();
    }
  };

  render();
  if (scenarioStore.get().listStatus === 'idle') {
    void loadScenarios();
  }

  const unsubscribeScenario = scenarioStore.subscribe(render);
  const unsubscribeBuilding = buildingStore.subscribe(() => {
    if (mode === 'draft') {
      renderSelectedBuildingLabel();
    }
  });
  const unsubscribeRun = runStore.subscribe(() => {
    if (mode === 'list') {
      renderListMode();
    }
  });

  return {
    destroy: (): void => {
      unsubscribeScenario();
      unsubscribeBuilding();
      unsubscribeRun();
      container.removeChild(shell.element);
    },
  };
}
