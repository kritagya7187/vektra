import { beforeEach, describe, expect, it } from 'vitest';
import {
  layerVisibilityStore,
  setLayerVisible,
  showOnlyFloodMetric,
  toggleLayer,
} from '../../../src/state/layerVisibilityState';
function reset(): void {
layerVisibilityStore.set({
  terrain: true,
  imagery: true,
  buildings3d: true,
  maxDepth: true,
  arrivalTime: false,
  duration: false,
  adminBoundary: false,
});
}
beforeEach(reset);
describe('setLayerVisible', () => {
  it('sets exactly the named layer, leaving every other layer untouched', () => {
    setLayerVisible('terrain', false);
    const state = layerVisibilityStore.get();
    expect(state.terrain).toBe(false);
    expect(state.imagery).toBe(true);
    expect(state.buildings3d).toBe(true);
  });
});
describe('toggleLayer', () => {
  it('flips exactly the named layer', () => {
    toggleLayer('imagery');
    expect(layerVisibilityStore.get().imagery).toBe(false);
    toggleLayer('imagery');
    expect(layerVisibilityStore.get().imagery).toBe(true);
  });
});
describe('showOnlyFloodMetric', () => {
  it('turns on exactly the named flood metric and turns off the other two', () => {
    showOnlyFloodMetric('arrivalTime');
    const state = layerVisibilityStore.get();
    expect(state.maxDepth).toBe(false);
    expect(state.arrivalTime).toBe(true);
    expect(state.duration).toBe(false);
  });
  it('never touches terrain/imagery/buildings3d', () => {
    showOnlyFloodMetric('duration');
    const state = layerVisibilityStore.get();
    expect(state.terrain).toBe(true);
    expect(state.imagery).toBe(true);
    expect(state.buildings3d).toBe(true);
  });
});
