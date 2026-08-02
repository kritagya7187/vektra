# flood-engine dependency policy

A dependency may be added to this package only if it satisfies at least one
documented requirement in the Scientific Design Specification (SDS),
Numerical Model Specification (NMS), Validation Specification, Experiment
Plan, or the implementation architecture recorded in the project plan.
"It's common" or "it's convenient" is not a justification on its own.

This document states the *rule and process*. It deliberately does not
duplicate the current dependency list — that list lives in exactly one
place, `pyproject.toml`'s `[project] dependencies` and
`[dependency-groups] dev` tables, so there is never a second copy that can
drift out of date. The reasoning behind each entry currently there is
recorded in the plan record's Step 3 review.

## Required justification for any new dependency

Proposed in the same shape every time, before the dependency is added:

| Field | Requirement |
|---|---|
| Package name | — |
| Purpose | What it is used for, concretely |
| Requirement it satisfies | The specific SDS/NMS/Validation Spec/Experiment Plan/architecture section it traces to — not "seems useful" |
| Runtime or development | Runtime deps ship in production; dev deps do not |
| Why over alternatives | If more than one package could do this, why this one — especially: does an already-declared dependency already cover this (avoid duplicate functionality)? |

## Standing rules

1. No dependency without a traceable requirement.
2. Runtime and development dependencies stay in separate tables (`[project] dependencies` vs. `[dependency-groups] dev`).
3. Before adding a package, check whether an already-declared dependency covers the need (e.g. GeoPandas already provides Shapely and vector I/O — don't add a second vector library, a second HTTP framework, a second geometry library).
4. Version ranges are compatible-release ranges (`>=X,<Y`), not exact pins, unless a specific reproducibility requirement demands otherwise.
5. Adding a dependency is a reviewable change, same as any other architectural decision in this project — it does not get waved through because "everyone uses it."

## What this policy does not cover

Scientific parameters (Manning's *n*, Curve Number infiltration values,
WCA2D timestep/stability constants) are not a dependency-policy concern —
they are frozen NMS constants that live in `flood_engine.core` code, not
configuration, and are never introduced as, or controlled by, a third-party
package or an environment variable. See `flood_engine/config.py`'s module
docstring for the full separation.
