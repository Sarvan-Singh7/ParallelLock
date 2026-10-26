/**
 * server.js – entry point.
 *
 * Imports the pre-built Express app and calls listen().
 * Keeping listen() here (not in app.js) means tests can import app.js
 * without accidentally opening a port.
 */
import app      from './app.js';
import { env }  from './config/env.js';

const server = app.listen(env.PORT, () => {
  console.log(`🚀  ParallelLock API listening on port ${env.PORT}`);
});

// Graceful shutdown: stop accepting new connections, then exit.
function shutdown(signal) {
  console.log(`Shutting down (${signal})...`);
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
