"""Stage 1 solver implementation: WCA2D (Weighted Cellular Automata 2D).

Isolated from ``flood_engine.core`` proper so the NMS's model-class /
implementation split is physically enforced: code that depends on the WCA2D
formulation specifically (as opposed to the general "reduced-complexity
overland-flow engine" contract) lives only here. A future Stage 1 solver
swap replaces this sub-package's contents without touching ``grid``,
``state``, ``timestepping``, or ``conservation``.
"""
