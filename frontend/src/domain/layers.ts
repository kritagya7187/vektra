export const LAYER_IDS = [
  'terrain',
  'imagery',
  'buildings3d',
  'maxDepth',
  'arrivalTime',
  'duration',
  'adminBoundary',
] as const;
export type LayerId = (typeof LAYER_IDS)[number];
export type LayerVisibility = Readonly<Record<LayerId, boolean>>;
