import { describe, expect, it } from 'vitest';
import {
  defaultBuildingStyle,
  NEUTRAL_FILL_CSS,
  NEUTRAL_OUTLINE_CSS,
} from '../../../src/domain/styling';

describe('defaultBuildingStyle', () => {
  it('returns the neutral fill/outline colors', () => {
    const style = defaultBuildingStyle();
    expect(style.fillColorCss).toBe(NEUTRAL_FILL_CSS);
    expect(style.outlineColorCss).toBe(NEUTRAL_OUTLINE_CSS);
  });

  it('is deterministic — repeated calls produce identical styling', () => {
    expect(defaultBuildingStyle()).toEqual(defaultBuildingStyle());
  });
});
