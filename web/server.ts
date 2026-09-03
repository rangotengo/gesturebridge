import { loadEnvConfig } from '@next/env';
const projectDir = process.cwd();
loadEnvConfig(projectDir);

import util from 'util';
// Polyfill util.isNullOrUndefined for compatibility with legacy dependencies on modern Node.js versions (e.g. Node 22/24)
type UtilWithNullGuard = typeof util & {
  isNullOrUndefined?: (value: unknown) => value is null | undefined;
};
const utilWithNullGuard = util as UtilWithNullGuard;
if (typeof utilWithNullGuard.isNullOrUndefined === 'undefined') {
  utilWithNullGuard.isNullOrUndefined = (value: unknown): value is null | undefined => {
    return value === null || value === undefined;
  };
}

import { createServer } from 'http';
import next from 'next';
import { readServerConfig } from './lib/config';
import { closeDB, connectDB } from './lib/db';
import { logError, logInfo } from './lib/logger';
import { setupSocketIO } from './lib/socket';

async function main(): Promise<void> {
  const config = readServerConfig();
  const dev = config.nodeEnv !== 'production';

  // 1. Prepare Next.js app
  const app = next({ dev, hostname: config.host, port: config.port });
  const handle = app.getRequestHandler();
  await app.prepare();

  // 2. Connect to MongoDB in background
  void connectDB().catch((err: unknown) => {
    logError('server.initial_database_connect_failed', err);
  });

  // 3. Create HTTP server + attach Socket.IO
  const httpServer = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      logError('server.next_request_failed', err, { method: req.method ?? 'UNKNOWN' });
      res.writeHead(500);
      res.end('Internal Server Error');
    });
  });

  const io = setupSocketIO(httpServer);

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logInfo('server.shutdown_requested', { signal });

    const forcedExit = setTimeout(() => {
      logError('server.shutdown_timed_out', new Error('Graceful shutdown timed out'));
      process.exit(1);
    }, 10_000);
    forcedExit.unref();

    io.close(() => {
      httpServer.close((error) => {
        void closeDB()
          .catch((databaseError: unknown) => {
            logError('server.database_shutdown_failed', databaseError);
            process.exitCode = 1;
          })
          .finally(() => {
            clearTimeout(forcedExit);
            if (error) {
              logError('server.http_shutdown_failed', error);
              process.exitCode = 1;
            }
          });
      });
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  // 4. Start listening
  httpServer.listen(config.port, config.host, () => {
    logInfo('server.ready', {
      environment: dev ? 'development' : 'production',
      host: config.host,
      port: config.port,
    });
  });
}

main().catch((err) => {
  logError('server.startup_failed', err);
  process.exit(1);
});
