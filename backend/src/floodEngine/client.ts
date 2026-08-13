/**
 * Step 19 Part A/C: the dedicated client for the flood-engine FastAPI service.
 *
 * Every method here does exactly one thing: translate this backend's
 * request into flood-engine's real wire shape (Part D), make the HTTP
 * call, and translate the real response back (Part E) -- no business
 * logic, no recomputation, no reinterpretation of the job lifecycle
 * (Part C: "The Node backend must treat the Python engine as the source
 * of truth. It must never invent additional job states."). Matches the
 * existing `createXxxClient(options)` factory shape already established
 * by `ingestion/remoteSensing/clients/*.ts` (e.g. `SrtmDemClient.ts`),
 * not a new architectural pattern.
 */

import type { Logger } from 'pino';
import { config } from '../config';
import { rootLogger } from '../logging';
import { ExternalServiceError } from '../errors';
import { floodEngineFetch } from './httpClient';
import {
  fromCityRunDetailWire,
  fromCityRunSummaryWire,
  fromFloodOutputSummaryWire,
  fromPrepareRainfallEventResultWire,
  fromRainfallEventListWire,
  fromSimulationRunStatusWire,
  fromSubmitSimulationResponseWire,
  toSubmitSimulationRequestWire,
} from './translate';
import type {
  CityRunArtifact,
  CityRunBoundary,
  CityRunDetail,
  CityRunDetailWire,
  CityRunSummary,
  CityRunSummaryWire,
  DownloadedArtifact,
  FloodOutputSummary,
  FloodOutputSummaryWire,
  PrepareRainfallEventResult,
  PrepareRainfallEventResultWire,
  RainfallEventList,
  RainfallEventListWire,
  SimulationArtifact,
  SimulationRunStatus,
  SimulationRunStatusWire,
  SubmitSimulationRequest,
  SubmitSimulationResponseWire,
  SubmitSimulationResult,
} from './types';

export interface FloodEngineClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly maxPayloadBytes: number;
  readonly logger?: Logger;
}

export interface FloodEngineClient {
  submitSimulation(request: SubmitSimulationRequest): Promise<SubmitSimulationResult>;
  getSimulationStatus(runId: string): Promise<SimulationRunStatus>;
  getSimulationSummary(runId: string): Promise<FloodOutputSummary>;
  downloadSimulationArtifact(
    runId: string,
    artifact: SimulationArtifact,
  ): Promise<DownloadedArtifact>;
  cancelSimulation(runId: string): Promise<SimulationRunStatus>;
  listCityRuns(): Promise<readonly CityRunSummary[]>;
  getCityRun(runId: string): Promise<CityRunDetail>;
  downloadCityRunArtifact(runId: string, artifact: CityRunArtifact): Promise<DownloadedArtifact>;
  getCityRunBoundary(runId: string): Promise<CityRunBoundary>;
  listRainfallEvents(): Promise<RainfallEventList>;
  prepareRainfallEvent(eventDate: string): Promise<PrepareRainfallEventResult>;
}

function parseJsonBody<T>(body: Buffer, context: string): T {
  try {
    return JSON.parse(body.toString('utf8')) as T;
  } catch (err) {
    // A response that claimed success (2xx) but isn't valid JSON --
    // Part G's "malformed response" scenario. Never surfaced as a raw
    // SyntaxError: this is exactly the "flood-engine misbehaved"
    // category ExternalServiceError exists for, not this backend's own
    // input-validation problem.
    throw new ExternalServiceError(
      `The flood simulation engine returned a malformed response for ${context}.`,
      err,
    );
  }
}

/**
 * Builds a real client. Requires `options.baseUrl` to be a real,
 * non-empty URL — checked here, once, at construction time (matching
 * `SrtmDemClient`'s own "throw a clear error at the point of use rather
 * than block server startup" pattern for a not-yet-configured
 * integration), so every method below can assume it is already valid.
 */
export function createFloodEngineClient(options: FloodEngineClientOptions): FloodEngineClient {
  if (!options.baseUrl) {
    throw new Error(
      'FLOOD_ENGINE_BASE_URL must be set to use the flood-engine client (see backend/.env.example).',
    );
  }
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const logger =
    options.logger ?? rootLogger.child({ component: 'floodEngine', client: 'FloodEngineClient' });
  const httpOptions = { timeoutMs: options.timeoutMs, maxRetries: options.maxRetries, logger };

  function url(path: string): string {
    return `${baseUrl}${path}`;
  }

  return {
    async submitSimulation(request: SubmitSimulationRequest): Promise<SubmitSimulationResult> {
      const wireBody = toSubmitSimulationRequestWire(request);
      const payload = Buffer.from(JSON.stringify(wireBody), 'utf8');
      if (payload.byteLength > options.maxPayloadBytes) {
        throw new ExternalServiceError(
          `Simulation submission payload (${payload.byteLength} bytes) exceeds the configured ` +
            `limit (${options.maxPayloadBytes} bytes).`,
        );
      }

      const response = await floodEngineFetch(
        url('/api/v1/simulations'),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: payload,
        },
        httpOptions,
      );

      const wire = parseJsonBody<SubmitSimulationResponseWire>(response.body, 'job submission');
      return fromSubmitSimulationResponseWire(wire);
    },

    async getSimulationStatus(runId: string): Promise<SimulationRunStatus> {
      const response = await floodEngineFetch(
        url(`/api/v1/simulations/${encodeURIComponent(runId)}`),
        { method: 'GET' },
        httpOptions,
      );
      const wire = parseJsonBody<SimulationRunStatusWire>(response.body, 'job status');
      return fromSimulationRunStatusWire(wire);
    },

    async getSimulationSummary(runId: string): Promise<FloodOutputSummary> {
      const response = await floodEngineFetch(
        url(`/api/v1/simulations/${encodeURIComponent(runId)}/summary`),
        { method: 'GET' },
        httpOptions,
      );
      const wire = parseJsonBody<FloodOutputSummaryWire>(response.body, 'job summary');
      return fromFloodOutputSummaryWire(wire);
    },

    async downloadSimulationArtifact(
      runId: string,
      artifact: SimulationArtifact,
    ): Promise<DownloadedArtifact> {
      const response = await floodEngineFetch(
        url(`/api/v1/simulations/${encodeURIComponent(runId)}/download/${artifact}`),
        { method: 'GET' },
        httpOptions,
      );
      const contentDisposition = response.headers.get('content-disposition');
      const filenameMatch = contentDisposition?.match(/filename="?([^"]+)"?/);
      return {
        bytes: response.body,
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
        filename: filenameMatch ? filenameMatch[1] : null,
      };
    },

    async cancelSimulation(runId: string): Promise<SimulationRunStatus> {
      const response = await floodEngineFetch(
        url(`/api/v1/simulations/${encodeURIComponent(runId)}/cancel`),
        { method: 'POST' },
        httpOptions,
      );
      const wire = parseJsonBody<SimulationRunStatusWire>(response.body, 'job cancellation');
      return fromSimulationRunStatusWire(wire);
    },

    async listCityRuns(): Promise<readonly CityRunSummary[]> {
      const response = await floodEngineFetch(url('/api/v1/city-runs'), { method: 'GET' }, httpOptions);
      const wire = parseJsonBody<readonly CityRunSummaryWire[]>(response.body, 'city run list');
      return wire.map(fromCityRunSummaryWire);
    },

    async getCityRun(runId: string): Promise<CityRunDetail> {
      const response = await floodEngineFetch(
        url(`/api/v1/city-runs/${encodeURIComponent(runId)}`),
        { method: 'GET' },
        httpOptions,
      );
      const wire = parseJsonBody<CityRunDetailWire>(response.body, 'city run detail');
      return fromCityRunDetailWire(wire);
    },

    async downloadCityRunArtifact(
      runId: string,
      artifact: CityRunArtifact,
    ): Promise<DownloadedArtifact> {
      const response = await floodEngineFetch(
        url(`/api/v1/city-runs/${encodeURIComponent(runId)}/download/${artifact}`),
        { method: 'GET' },
        httpOptions,
      );
      const contentDisposition = response.headers.get('content-disposition');
      const filenameMatch = contentDisposition?.match(/filename="?([^"]+)"?/);
      return {
        bytes: response.body,
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
        filename: filenameMatch ? filenameMatch[1] : null,
      };
    },

    async getCityRunBoundary(runId: string): Promise<CityRunBoundary> {
      const response = await floodEngineFetch(
        url(`/api/v1/city-runs/${encodeURIComponent(runId)}/boundary`),
        { method: 'GET' },
        httpOptions,
      );
      return parseJsonBody<CityRunBoundary>(response.body, 'city run boundary');
    },

    async listRainfallEvents(): Promise<RainfallEventList> {
      const response = await floodEngineFetch(
        url('/api/v1/rainfall-events'),
        { method: 'GET' },
        httpOptions,
      );
      const wire = parseJsonBody<RainfallEventListWire>(response.body, 'rainfall event list');
      return fromRainfallEventListWire(wire);
    },

    async prepareRainfallEvent(eventDate: string): Promise<PrepareRainfallEventResult> {
      const response = await floodEngineFetch(
        url(`/api/v1/rainfall-events/${encodeURIComponent(eventDate)}/prepare`),
        { method: 'POST' },
        httpOptions,
      );
      const wire = parseJsonBody<PrepareRainfallEventResultWire>(
        response.body,
        'rainfall event prepare',
      );
      return fromPrepareRainfallEventResultWire(wire);
    },
  };
}

/**
 * The process-wide client, built from real deployment configuration —
 * the one real callers use (matching `repositories/index.ts`'s own
 * "export both the class and a ready-to-use instance" convention).
 * Constructing this eagerly at import time would throw for any
 * deployment that hasn't set FLOOD_ENGINE_BASE_URL yet (e.g. this
 * backend's own test suite) -- deferred to first real use instead, via
 * this getter, matching `config.floodEngine.baseUrl`'s own "optional at
 * the schema level, required at point of use" contract.
 */
let cachedClient: FloodEngineClient | undefined;

export function getFloodEngineClient(): FloodEngineClient {
  if (!cachedClient) {
    cachedClient = createFloodEngineClient({
      baseUrl: config.floodEngine.baseUrl ?? '',
      timeoutMs: config.floodEngine.timeoutMs,
      maxRetries: config.floodEngine.maxRetries,
      maxPayloadBytes: config.floodEngine.maxPayloadBytes,
    });
  }
  return cachedClient;
}
