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

/**
 * Input shape for creating a HeatExposureFactorValue (Heat Exposure
 * Engine subsystem — the only writer, matching db/migrations/0014's
 * INSERT grant to vektra_simulation). The CHECK (is_computable OR
 * factor_value IS NULL) constraint means a not-computable factor must be
 * created with factorValue omitted/null — enforced by the database, not
 * re-validated here.
 */
export interface CreateHeatExposureFactorValueInput {
  readonly resultId: string;
  readonly factorKey: FactorKey;
  readonly factorValue?: number | null;
  readonly isComputable: boolean;
  readonly notes?: string | null;
}
