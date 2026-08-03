/**
 * Step 20 §6: the six independently-toggleable layers. Shared between
 * state/layerVisibilityState.ts (the source of truth) and
 * scene/twinScene.ts (which renders whatever that store says) without
 * either importing the other directly — main.ts is the only place scene
 * and state meet, matching this app's existing architecture.
 *
 * Time Animation (§4) is implemented as automatically driving the three
 * flood-metric entries of this same visibility set in sequence (see
 * domain/timeline.ts + state/timelineState.ts), rather than a second,
 * parallel rendering pathway -- one mechanism controls what's on the
 * map, whether a user clicked a checkbox or the timeline is playing.
 */
export const LAYER_IDS = [
  'terrain',
  'imagery',
  'buildings3d',
  'maxDepth',
  'arrivalTime',
  'duration',
] as const;

export type LayerId = (typeof LAYER_IDS)[number];

export type LayerVisibility = Readonly<Record<LayerId, boolean>>;
