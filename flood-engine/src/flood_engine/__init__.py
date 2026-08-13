"""VEKTRA flood-engine — Earth-Observation-driven urban pluvial flood digital twin.

Implements the Stage 1 simulation engine specified in the frozen Numerical
Model Specification (NMS): a physically-grounded, raster-based,
reduced-complexity overland-flow engine (diffusive-wave class), initial
implementation via the WCA2D/CADDIES methodology (Guidolin et al. 2016).

Package layout enforces a one-directional dependency rule:

    core/  <-  simulation/, scenario/, inputs/  <-  api/, io/, preprocessing/, jobs/, persistence/

``core`` contains only pure scientific logic (NumPy arrays and dataclasses
in, NumPy arrays and dataclasses out) and must never import a framework or
infrastructure module. Everything that touches a file, socket, or database
lives in the outer layers. This mirrors the NMS's own separation between the
model *class* (durable) and its Stage 1 *implementation* (swappable).
"""

from flood_engine.io.proj_env import ensure_compatible_proj_data

ensure_compatible_proj_data()
