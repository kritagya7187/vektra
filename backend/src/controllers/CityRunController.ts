import type { Response } from 'express';
import { getFloodEngineClient } from '../floodEngine';
import type { CityRunArtifactParam, CityRunIdParam, ValidatedRequest } from '../validators';
import { sendData } from './respond';

export async function listCityRuns(_req: ValidatedRequest, res: Response): Promise<void> {
  const result = await getFloodEngineClient().listCityRuns();
  sendData(res, result);
}

export async function getCityRun(
  req: ValidatedRequest<CityRunIdParam>,
  res: Response,
): Promise<void> {
  const result = await getFloodEngineClient().getCityRun(req.params.runId);
  sendData(res, result);
}

export async function getCityRunBoundary(
  req: ValidatedRequest<CityRunIdParam>,
  res: Response,
): Promise<void> {
  const result = await getFloodEngineClient().getCityRunBoundary(req.params.runId);
  sendData(res, result);
}

export async function downloadCityRunArtifact(
  req: ValidatedRequest<CityRunArtifactParam>,
  res: Response,
): Promise<void> {
  const { runId, artifact } = req.params;
  const downloaded = await getFloodEngineClient().downloadCityRunArtifact(runId, artifact);
  res.status(200).set('content-type', downloaded.contentType);
  if (downloaded.filename) {
    res.set('content-disposition', `attachment; filename="${downloaded.filename}"`);
  }
  res.send(downloaded.bytes);
}
