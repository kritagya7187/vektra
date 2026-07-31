import type { Server } from 'node:http';
import { createApp } from './app';
import { config } from './config';
import { checkDatabaseHealth, closePool } from './database';
import { rootLogger } from './logging';

/**
 * Bounded shutdown timeout. A technical safety constant (so a stuck
 * connection can never hang shutdown forever), not an EDD-mandated or
 * env-configurable value — same category of decision as the database
 * connection timeout in the Database Connection Manager subsystem.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

let httpServer: Server | undefined;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  rootLogger.info({ signal }, 'shutdown initiated');

  const forceExitTimer = setTimeout(() => {
    rootLogger.error(
      { timeoutMs: SHUTDOWN_TIMEOUT_MS },
      'graceful shutdown timed out, forcing exit',
    );
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer?.close((err) => (err ? reject(err) : resolve()));
      });
      rootLogger.info('http server closed');
    }

    await closePool();

    clearTimeout(forceExitTimer);
    rootLogger.info('shutdown complete');
    process.exit(0);
  } catch (err) {
    clearTimeout(forceExitTimer);
    rootLogger.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

// Node's own guidance: do not attempt to resume normal operation after an
// uncaught exception or unhandled rejection — log the full detail
// server-side and exit, so a process manager can restart cleanly.
process.on('uncaughtException', (err) => {
  rootLogger.fatal({ err }, 'uncaught exception');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  rootLogger.fatal({ err: reason }, 'unhandled promise rejection');
  process.exit(1);
});

async function start(): Promise<void> {
  rootLogger.info({ nodeEnv: config.nodeEnv, port: config.server.port }, 'starting server');

  const health = await checkDatabaseHealth();
  if (!health.connected || !health.postgis.available) {
    // "No silent fallback if the database is unavailable... fail
    // clearly" (Database Connection Manager subsystem) applies equally
    // at startup: every table in the reviewed schema depends on live
    // PostGIS, so "connected but PostGIS unavailable" is just as
    // startup-blocking as no connection at all.
    rootLogger.fatal({ health }, 'database initialization failed, refusing to start');
    process.exit(1);
    return;
  }
  rootLogger.info(
    { latencyMs: health.latencyMs, postgisVersion: health.postgis.version },
    'database connection verified',
  );

  const app = createApp();
  httpServer = app.listen(config.server.port, () => {
    rootLogger.info({ port: config.server.port }, 'server listening');
  });
}

start().catch((err: unknown) => {
  rootLogger.fatal({ err }, 'fatal error during startup');
  process.exit(1);
});
