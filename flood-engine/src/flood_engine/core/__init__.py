"""Pure scientific/domain logic for the Stage 1 overland-flow engine.

Every module in this package implements one frozen section of the Numerical
Model Specification (NMS) and nothing else:

- ``grid``            -> NMS "Grid" (30m Copernicus GLO-30 cells, UTM 43N, AOI)
- ``state``            -> NMS "State variable" and SDS Section 3 (State(t))
- ``solver.wca2d``      -> NMS "Cell update rule"
- ``solver.roughness``  -> NMS "Roughness - Manning's n per land-cover class"
- ``solver.infiltration`` -> NMS "Infiltration" (SCS Curve Number, pre-processing loss)
- ``timestepping``      -> NMS "Stability / timestep"
- ``conservation``      -> NMS "Mass conservation"

Constraint enforced by code review, not by the language: no module in this
package may import ``rasterio``, ``geopandas``, ``fastapi``, ``sqlalchemy``,
or perform any file/network/database I/O. Inputs and outputs are NumPy
arrays and the dataclasses defined in ``state`` and ``grid``. This is what
makes the solver unit-testable without a filesystem or a running service,
and what confines a future Stage 2 solver swap to this package alone.
"""
