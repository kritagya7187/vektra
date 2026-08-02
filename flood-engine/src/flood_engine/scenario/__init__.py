"""The ``flood_scenario`` domain object, frozen in SDS Section 5.

A scenario is defined independently of any run: rainfall forcing (historical
replay or synthetic design storm), optional DEM/land-cover/building-mask
modifications, and simulation duration/output-interval settings. This
package defines that object and its validation rules only — persisting a
scenario is a ``flood_engine.persistence`` concern, and turning a scenario
into a simulation run is a ``flood_engine.simulation`` concern.
"""
