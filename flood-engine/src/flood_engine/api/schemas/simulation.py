"""api.schemas.simulation: Pydantic mirrors of the output-side domain types (Step 15).

**Scope, deliberately narrow**: field-for-field mirrors of
:class:`~flood_engine.core.state.MassLedger` and
:class:`~flood_engine.output.generator.FloodOutputSummary` only -- the two
output-side types whose shape is already frozen by Steps 11/14 and needs
no persistence-dependent design decision to serialize. Not yet attached to
any endpoint (none exist yet, see ``flood_engine.api``'s module
docstring).

**Deliberately not built here**: a request schema. Its shape would need to
answer questions this layer cannot answer yet -- does a client submit raw
elevation/rainfall arrays inline, or a reference to an already-persisted
scenario (SDS Section 5)? -- which depend on Step 17 (persistence) and
would likely be redesigned once it exists. Building one now would be
inventing a request body, which this step's own instructions forbid. Also
not built: a :class:`~flood_engine.simulation.controller.SimulationResult`
mirror -- its ``timestep_records`` can be arbitrarily large (one entry per
adaptive substep), and whether a future endpoint should ever serialize the
full sequence over HTTP (versus just the already-built
:class:`~flood_engine.output.generator.FloodOutputSummary`) is an API
design decision no frozen document has settled.
"""

import math

from pydantic import BaseModel, ConfigDict

from flood_engine.core.state import MassLedger
from flood_engine.output.generator import FloodOutputSummary


def _nan_to_none(value: float) -> float | None:
    """JSON has no native NaN -- ``null`` is the standard, only-sensible representation.

    Not a design choice specific to this project: JSON (RFC 8259) simply
    does not define a NaN literal, so some conversion is unavoidable for
    any endpoint that ever serializes ``arrival_time_min`` -- ``null``
    matches that field's own documented semantics ("a correct absence of
    value").
    """
    return None if math.isnan(value) else value


class MassLedgerSchema(BaseModel):
    """Field-for-field mirror of :class:`~flood_engine.core.state.MassLedger`."""

    model_config = ConfigDict(frozen=True)

    rainfall_input_m3: float
    infiltration_loss_m3: float
    boundary_outflow_m3: float

    @classmethod
    def from_domain(cls, ledger: MassLedger) -> MassLedgerSchema:
        """Build a schema instance from the domain type -- no computation, only translation."""
        return cls(
            rainfall_input_m3=ledger.rainfall_input_m3,
            infiltration_loss_m3=ledger.infiltration_loss_m3,
            boundary_outflow_m3=ledger.boundary_outflow_m3,
        )


class FloodOutputSummarySchema(BaseModel):
    """Field-for-field mirror of :class:`~flood_engine.output.generator.FloodOutputSummary`.

    ``NDArray`` fields become nested lists -- JSON's only representation
    of a 2D numeric array, not a design choice made here.
    """

    model_config = ConfigDict(frozen=True)

    max_depth_m: list[list[float]]
    arrival_time_min: list[list[float | None]]
    duration_above_threshold_min: list[list[float]]
    mass_ledger: MassLedgerSchema
    step_count: int
    simulated_duration_s: float

    @classmethod
    def from_domain(cls, summary: FloodOutputSummary) -> FloodOutputSummarySchema:
        """Build a schema instance from the domain type -- no computation, only translation."""
        arrival_time_min = [
            [_nan_to_none(float(value)) for value in row] for row in summary.arrival_time_min
        ]
        return cls(
            max_depth_m=summary.max_depth_m.tolist(),
            arrival_time_min=arrival_time_min,
            duration_above_threshold_min=summary.duration_above_threshold_min.tolist(),
            mass_ledger=MassLedgerSchema.from_domain(summary.mass_ledger),
            step_count=summary.step_count,
            simulated_duration_s=summary.simulated_duration_s,
        )


__all__ = ["FloodOutputSummarySchema", "MassLedgerSchema"]
