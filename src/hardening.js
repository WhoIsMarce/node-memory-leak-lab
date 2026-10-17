import helmet from 'helmet';
import { mkdirSync } from 'node:fs';
import { writeHeapSnapshot } from 'node:v8';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const FILTER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const isProduction = process.env.NODE_ENV === 'production';

// Debug endpoints (memory stats, heap snapshots) exist for the lab only.
// A heap snapshot contains everything that is in memory, secrets included.
export const debugEnabled = !isProduction;

export function applySecurity(app) {
  app.disable('x-powered-by'); // do not advertise the framework
  app.use(helmet());           // security headers, including a strict CSP
}

// The filter ends up in a cache key, so it must be a short, plain string.
export function validateFilter(req, res, next) {
  const { filter } = req.query;
  if (typeof filter !== 'string' || !FILTER_PATTERN.test(filter)) {
    return res.status(400).json({
      error: 'filter must be 1-64 characters: letters, digits, "-" or "_"',
    });
  }
  next();
}

export function registerDebugRoutes(app, getExtraStats) {
  if (!debugEnabled) return;

  const toMB = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;

  app.get('/debug/memory', (_req, res) => {
    global.gc?.(); // needs --expose-gc; shows only memory that is still retained
    const m = process.memoryUsage();
    res.json({
      rssMB: toMB(m.rss),
      heapUsedMB: toMB(m.heapUsed),
      heapTotalMB: toMB(m.heapTotal),
      externalMB: toMB(m.external),
      arrayBuffersMB: toMB(m.arrayBuffers),
      ...getExtraStats(),
    });
  });

  app.post('/debug/heap-snapshot', (_req, res) => {
    mkdirSync('snapshots', { recursive: true });
    const file = writeHeapSnapshot(`snapshots/heap-${Date.now()}.heapsnapshot`);
    res.json({ file });
  });
}

// Register these after every route: unknown paths get a JSON 404 and
// unexpected errors never leak a stack trace to the client.
export function registerErrorHandlers(app) {
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Express recognizes error handlers by their four parameters.
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });
}

export function listen(app) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1'; // loopback only by default

  if (debugEnabled && !LOOPBACK_HOSTS.has(host)) {
    console.warn(
      `WARNING: debug endpoints are enabled and the server is bound to ${host}. ` +
        'Anyone who can reach this address can download a heap snapshot.'
    );
  }

  app.listen(port, host, (err) => {
    if (err) {
      console.error('Could not start server:', err.message);
      process.exit(1);
    }
    console.log(`Listening on http://${host}:${port}`);
  });
}