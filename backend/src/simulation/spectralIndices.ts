/**
 * Phase 3 Milestone 2. Standard, pre-existing, named remote-sensing
 * indices only — EDD Section 18: "a standard, well-established
 * remote-sensing vegetation index... referenced by name... not an
 * equation invented for VEKTRA." Neither formula below is novel;
 * NDVI (Rouse et al., 1974) and NDBI (Zha et al., 2003) are two of the
 * most widely cited indices in remote sensing, reproduced here exactly
 * as universally defined, not adapted or reweighted.
 */

/** Normalized Difference Vegetation Index: (NIR - Red) / (NIR + Red). Range [-1, 1]; higher indicates denser vegetation. */
export function computeNdvi(nearInfrared: number, red: number): number | null {
  const denominator = nearInfrared + red;
  if (denominator === 0) {
    return null;
  }
  return (nearInfrared - red) / denominator;
}

/** Normalized Difference Built-up Index: (SWIR - NIR) / (SWIR + NIR). Range [-1, 1]; higher indicates more built-up surface. */
export function computeNdbi(shortwaveInfrared: number, nearInfrared: number): number | null {
  const denominator = shortwaveInfrared + nearInfrared;
  if (denominator === 0) {
    return null;
  }
  return (shortwaveInfrared - nearInfrared) / denominator;
}
