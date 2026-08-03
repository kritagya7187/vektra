import type { Response } from 'express';
import { getFloodEngineClient } from '../floodEngine';
import type {
  FloodSimulationArtifactParam,
  FloodSimulationRunIdParam,
  SubmitFloodSimulationBody,
  ValidatedRequest,
} from '../validators';
import { sendData } from './respond';

/**
 * Step 20 Part 0b: the disclosed prerequisite this step's own architecture
 * audit found -- Step 19 built a Node-side client
 * (backend/src/floodEngine/client.ts) that can talk to the flood-engine
 * FastAPI service, but never exposed it over HTTP, so the frontend had
 * no way to reach it (the frozen "Frontend -> Node backend -> HTTP ->
 * FastAPI" diagram was broken at its first hop). Every handler here is a
 * thin pass-through to that already-frozen client -- no new business
 * logic, matching Step 19's own "orchestration only" discipline. Thrown
 * client errors (ExternalServiceError/NotFoundError/ConflictError/
 * ValidationError, all built in Step 19) propagate automatically through
 * asyncHandler -> the existing errorHandler middleware, same as every
 * other controller in this codebase.
 */

const HTTP_ACCEPTED = 202;

export async function submitFloodSimulation(
  req: ValidatedRequest<unknown, unknown, SubmitFloodSimulationBody>,
  res: Response,
): Promise<void> {
  const result = await getFloodEngineClient().submitSimulation(req.body);
  sendData(res, result, HTTP_ACCEPTED);
}

export async function getFloodSimulationStatus(
  req: ValidatedRequest<FloodSimulationRunIdParam>,
  res: Response,
): Promise<void> {
  const result = await getFloodEngineClient().getSimulationStatus(req.params.runId);
  sendData(res, result);
}

export async function getFloodSimulationSummary(
  req: ValidatedRequest<FloodSimulationRunIdParam>,
  res: Response,
): Promise<void> {
  const result = await getFloodEngineClient().getSimulationSummary(req.params.runId);
  sendData(res, result);
}

export async function downloadFloodSimulationArtifact(
  req: ValidatedRequest<FloodSimulationArtifactParam>,
  res: Response,
): Promise<void> {
  const { runId, artifact } = req.params;
  const downloaded = await getFloodEngineClient().downloadSimulationArtifact(runId, artifact);
  res.status(200).set('content-type', downloaded.contentType);
  if (downloaded.filename) {
    res.set('content-disposition', `attachment; filename="${downloaded.filename}"`);
  }
  res.send(downloaded.bytes);
}

export async function cancelFloodSimulation(
  req: ValidatedRequest<FloodSimulationRunIdParam>,
  res: Response,
): Promise<void> {
  const result = await getFloodEngineClient().cancelSimulation(req.params.runId);
  sendData(res, result);
}
