"""Infrastructure: PostgreSQL/PostGIS integration.

As of Step 17: ``schema.py`` owns the DDL for the two entities Step 16's
worker needs (``flood_simulation_run``, ``flood_simulation_output``);
``models.py`` defines plain dataclasses mirroring their row shapes (not an
ORM -- see ``repository.py``'s own module docstring for why);
``serialization.py`` converts between the frozen domain types
(``MassLedger``, ``FloodOutputSummary``) and their storable forms;
``repository.py`` implements ``PostgresJobRepository``, the concrete
:class:`~flood_engine.jobs.repository.JobRepository`. This is the only
package permitted to execute SQL. It shares the same VEKTRA PostGIS
database/provenance conventions as the existing Node backend rather than
introducing a second database.

The remaining SDS Section 7 entities (``flood_scenario``,
``flood_building_exposure``, ``flood_road_exposure``,
``flood_facility_exposure``) are not built here -- ``flood_scenario`` in
particular has no table anywhere yet (see the plan record's Step 17
resolution for how this step routes around that gap); the exposure
entities depend on exposure analysis, not built in any step so far.
``persistence/repositories/`` remains an empty placeholder package,
unused by this step's flat-file layout.
"""
