import { Router } from 'express';
import { buildingsRouter } from './routes/buildings';
import { cityRunsRouter } from './routes/cityRuns';
import { dataProvenanceRouter } from './routes/dataProvenance';
import { dataSourcesRouter } from './routes/dataSources';
import { environmentalRasterAssetsRouter } from './routes/environmentalRasterAssets';
import { floodSimulationsRouter } from './routes/floodSimulations';
import { meteorologicalObservationsRouter } from './routes/meteorologicalObservations';
import { rainfallEventsRouter } from './routes/rainfallEvents';
import { simulationRunsRouter } from './routes/simulationRuns';

/**
 * Every REST resource, mounted under one Router that app.ts mounts once
 * at '/api'. Ordering between resources doesn't matter (disjoint path
 * prefixes) — only the ordering WITHIN simulationRuns.ts
 * (latest-baseline before :id) does.
 */
export const apiRouter = Router();

apiRouter.use('/data-sources', dataSourcesRouter);
apiRouter.use('/data-provenance', dataProvenanceRouter);
apiRouter.use('/buildings', buildingsRouter);
apiRouter.use('/environmental-raster-assets', environmentalRasterAssetsRouter);
apiRouter.use('/meteorological-observations', meteorologicalObservationsRouter);
apiRouter.use('/simulation-runs', simulationRunsRouter);
apiRouter.use('/flood-simulations', floodSimulationsRouter);
apiRouter.use('/city-runs', cityRunsRouter);
apiRouter.use('/rainfall-events', rainfallEventsRouter);
