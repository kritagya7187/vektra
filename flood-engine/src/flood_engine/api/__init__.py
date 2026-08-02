"""Infrastructure: the FastAPI service layer (Step 15).

**Current status, corrected from this file's earlier, aspirational
docstring**: every one of SDS Section 8's five frozen endpoints requires
either persistence (Step 17) or the async job-queue capability the SDS
itself says that contract needs (Step 16) -- neither exists yet. Step 15
therefore implements the application shell only: ``app`` assembles the
FastAPI application and its exception handlers (translating
``WCA2DError``/``TimesteppingError``/``SimulationControllerError`` into
HTTP responses); ``schemas`` defines Pydantic mirrors of the output-side
types that don't depend on persistence-dependent design decisions. No
routes are registered. ``routers`` remains empty until Steps 16/17 exist
to support the frozen contract -- implementing any SDS Section 8 endpoint
now would mean either inventing a synchronous replacement the SDS
explicitly says not to build, or reaching into persistence this package
must not depend on yet.
"""
