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

/**
 * Input shape for creating a HeatExposureResult (Heat Exposure Engine
 * subsystem — the only writer, matching db/migrations/0014's INSERT
 * grant to vektra_simulation). indexValue is always omitted/null here:
 * see this subsystem's engineering review for why the composite index
 * is never computed by this implementation (Section 18).
 */
export interface CreateHeatExposureResultInput {
  readonly runId: string;
  readonly buildingId: string;
  readonly indexValue?: number | null;
}
