# Numerical deviations from the University of Exeter reference implementation

`core.solver.wca2d` and `core.timestepping` reimplement the WCA2D algorithm
and driving loop described in the project's frozen "Step 11 — WCA2D
Numerical Algorithm Specification", itself transcribed from the real,
MIT-licensed reference implementation (University of Exeter Centre for
Water Systems, `github.com/FluiditLtd/caddies-caflood`, `fluidit-dev`
branch). This document is the single place every intentional,
scientifically-reviewed difference between VEKTRA's implementation and that
reference is recorded, so a future reviewer or collaborator never has to
rediscover them by re-reading both source trees side by side.

A deviation is listed here only if it was found and reviewed during a
Numerical Fidelity Audit and deliberately kept (not fixed). An entry that
was found and fixed is not a current deviation and does not belong here —
it belongs in the plan record's history as a resolved audit finding.

| Component | Reference implementation | VEKTRA | Status |
|---|---|---|---|
| Adaptive-timestep fraction snapping | `computeDT` snaps the raw Courant-type bound to the largest `time_maxdt / k` at or below it, for periodic output/1D-model-coupling synchronization | Uses the raw bound directly (`numpy.clip` to `[time_mindt, time_maxdt]`), no snapping | **Accepted for Stage 1** — an operational synchronization need VEKTRA has no equivalent of yet, not a stability requirement. Impact bounded to at most one fraction step, both remaining within the same stability bound. |
| `potential_va` (forcing-driven timestep term) | `dtn1 = min(time_maxdt, alpha*Δx/potential_va, alpha*Δx/grid_max_va)` — `potential_va` bounds the step against upcoming rainfall/inflow/coupling events | Omitted — VEKTRA computes `dtn1 = min(time_maxdt, alpha*Δx/grid_max_va)` only | **Accepted for Stage 1** — requires the caller to know the rainfall *schedule* ahead of the current step, which is Step 12/13's concern; `core.solver.wca2d` is not given that schedule today. |
| Open boundary condition | No physical open-boundary model in the outflow kernel itself — a domain-edge cell with outflow raises an alarm (`caActivateAlarm`) for the driver to handle, typically by expanding the computational domain (`setup.expand_domain`) | An off-grid neighbor is substituted with the central cell's own elevation (`H_boundary = z_center`), producing an outward gradient equal to the cell's own depth | **Documented, not a defect** — this is a VEKTRA-specific engineering decision satisfying the NMS's "open/free outflow" *requirement*, not a mechanism copied from the reference. Never described as "the WCA2D boundary condition" elsewhere in this codebase. |
| Infiltration cadence | Rainfall added every fine adaptive substep; infiltration applied only periodically (`t >= time_dt \|\| --iter_dt == 0`), using a rate pre-scaled by the period duration | Matches the reference: `step()` takes `apply_infiltration`/`infiltration_period_s`; the controller (`core.timestepping`, Step 12) decides cadence, the solver performs the numerical removal | **Matches reference** — resolved by the post-Step-11 Numerical Fidelity Audit; see the plan record's "Infiltration cadence — resolved" section for the full finding and fix. |
| Infiltration application interval | `period_time_dt = setup.time_updatedt`, itself constrained by `time_maxdt ≤ time_updatedt ≤ 60s` | `infiltration_interval_s = 60.0s` in `core.timestepping` | **Sourced, matches reference** — the only value consistent with VEKTRA's already-frozen `time_maxdt_s = 60.0` under the reference's own constraint; not an independent judgment call. See the plan record's "Step 12 — Pre-Implementation Numerical Parameter Resolution." |
| Rainfall substep mapping | Piecewise-constant (`Rain.cpp`): rate held constant at the current time-series entry until the next time boundary, then switches discontinuously — confirmed, no interpolation anywhere in the reference | Piecewise-constant, matching the reference | **Matches reference.** An earlier version used linear interpolation between adjacent hourly rates instead (a deliberate, project-owner-confirmed deviation). A numerical-fidelity review found that design violates per-hour rainfall-volume conservation — interpolating between anchors `R_k`/`R_{k+1}` makes hour `k`'s integral `(R_k+R_{k+1})/2 * 3600`, not `R_k * 3600` — confirmed both algebraically and numerically (over 100% error in a single interval for a realistic test series: `rates=[10,40,5,20]` produced hour errors of +150%, -44%, +150%, 0%, and a +6.7% aggregate error even after partial cancellation). Reverted to piecewise-constant, which conserves each hour's volume exactly by construction. See the plan record's "Step 12 — Rainfall conservation review" section. Recession tail (after the forcing's covered duration ends) is forced to exactly zero rainfall, not extrapolated. A separate, much smaller, bounded residual remains: an adaptive substep whose `dt_s` straddles an hour boundary uses its start hour's rate for its own full duration (bounded by one substep's duration per crossing, e.g. ≤60s/3600s ≈ 1.7% by default) — inherent to any coarser-forcing-under-finer-substepping scheme, present in the reference too, not introduced by this choice. |

## Review discipline

Any change to `core/solver/wca2d.py` that could alter simulation output
(not a pure refactor) requires a dedicated numerical audit before merge,
per the project's Step 11 freeze — this module is now VEKTRA's reference
implementation of the frozen Numerical Algorithm Specification, not just
another application module. If an audit finds a new deviation and it is
kept rather than fixed, add a row here in the same review that approves
keeping it; don't let this document drift out of sync with the code.
