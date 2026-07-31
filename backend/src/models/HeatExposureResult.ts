/**
 * heat_exposure_result (db/migrations/0012). HeatExposureResult entity
 * (EDD Section 16), Derived/Computed Layer (Section 15). One row per
 * (simulation_run, building) pair.
 *
 * indexValue is nullable and `number` when present — a `pg` NUMERIC
 * column, see Building.ts's driver-parsing note. Nullable because
 * Section 18's composite-combination methodology is explicitly "Requires
 * future implementation"; a run may populate only per-factor values
 * (HeatExposureFactorValue) and leave this null.
 */
export interface HeatExposureResult {
  readonly resultId: string;
  readonly runId: string;
  readonly buildingId: string;
  readonly indexValue: number | null;
  readonly computedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
