/**
 * scenario (db/migrations/0010). Scenario entity (EDD Section 16, 19). A
 * named, versioned overlay referencing exactly one baseline SimulationRun
 * and, once executed, exactly one derived SimulationRun.
 *
 * derivedRunId starts null and is set exactly once, after execution
 * (fn_guard_scenario_update) — the one legitimate mutation this
 * otherwise append-only entity permits.
 */
export interface Scenario {
  readonly scenarioId: string;
  readonly baselineRunId: string;
  readonly derivedRunId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly createdBy: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Input shape for creating a Scenario (FR-8). Excludes server-generated
 * fields (scenarioId, createdAt, updatedAt) and derivedRunId, which
 * starts null and is only ever set by the simulation subsystem after
 * execution — never by the create request itself. The only "create"
 * DTO defined for this entity, because db/migrations/0014's actual
 * grants are the only justification: vektra_backend_api has INSERT on
 * scenario, so this is a real, used capability, not a guess.
 */
export interface CreateScenarioInput {
  readonly baselineRunId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly createdBy?: string | null;
}
