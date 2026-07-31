/**
 * scenario_override (db/migrations/0011). Child of Scenario, realizing
 * Section 16's "ordered list of attribute overrides." sequenceNumber
 * preserves the stated ordering. attributeName/overrideValue are plain
 * strings because the EDD never enumerates the closed set of overridable
 * attributes it references (Section 22) — see the migration's own TODO.
 */
export interface ScenarioOverride {
  readonly overrideId: string;
  readonly scenarioId: string;
  readonly buildingId: string;
  readonly sequenceNumber: number;
  readonly attributeName: string;
  readonly overrideValue: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Input shape for creating a ScenarioOverride, mirroring
 * db/migrations/0014's grant of INSERT on scenario_override to
 * vektra_backend_api. Excludes overrideId/createdAt/updatedAt.
 */
export interface CreateScenarioOverrideInput {
  readonly scenarioId: string;
  readonly buildingId: string;
  readonly sequenceNumber: number;
  readonly attributeName: string;
  readonly overrideValue: string;
}
