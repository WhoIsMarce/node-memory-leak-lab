import express from 'express';
import { EventEmitter } from 'node:events';
import {
  applySecurity,
  validateFilter,
  registerDebugRoutes,
  registerErrorHandlers,
  listen,
} from './hardening.js';

const app = express();
const bus = new EventEmitter();

applySecurity(app);

// ---------- Leak #1: cache with no upper bound ----------
const reportCache = new Map();

function buildReport(filter) {
  return {
    filter,
    generatedAt: Date.now(),
    rows: Array.from({ length: 200 }, (_, i) => ({
      id: i,
      label: `row-${i}-${filter}`,
    })),
  };
}

app.get('/report', validateFilter, (req, res) => {
  const key = req.originalUrl;
  if (!reportCache.has(key)) {
    reportCache.set(key, buildReport(req.query.filter));
  }
  res.json({ key, rows: reportCache.get(key).rows.length });
});

// ---------- Leak #2: listeners that are never removed ----------
app.get('/subscribe', (req, res) => {
  const payload = Buffer.alloc(50 * 1024); // 50 KB per subscriber
  bus.on('tick', () => payload.length);    // closure keeps `payload` alive
  res.json({ subscribers: bus.listenerCount('tick') });
});

setInterval(() => bus.emit('tick'), 5_000).unref();

registerDebugRoutes(app, () => ({
  cacheEntries: reportCache.size,
  tickListeners: bus.listenerCount('tick'),
}));
registerErrorHandlers(app);
listen(app);