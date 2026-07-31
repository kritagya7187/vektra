import type { FactorKey } from '../types/enums';

/**
 * heat_exposure_factor_value (db/migrations/0013). Child of
 * HeatExposureResult, realizing Section 16's "per-factor contributing
 * values (Section 18)."
 *
 * factorValue is nullable and `number` when present — a `pg` NUMERIC
 * column, see Building.ts's driver-parsing note. isComputable = false
 * marks a factor as "not computable with available data" per Section
 * 18's explicit instruction, rather than approximating it.
 */
export interface HeatExposureFactorValue {
  readonly factorValueId: string;
  readonly resultId: string;
  readonly factorKey: FactorKey;
  readonly factorValue: number | null;
  readonly isComputable: boolean;
  readonly notes: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
