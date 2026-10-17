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

// ---------- Fix #1: cache with an upper bound (LRU) ----------
class LRUCache {
  constructor(maxEntries) {
    this.maxEntries = maxEntries;
    this.map = new Map(); // a Map remembers insertion order
  }

  has(key) {
    return this.map.has(key);
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key); // re-insert to mark as most recently used
    this.map.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      this.map.delete(oldestKey);
    }
  }

  get size() {
    return this.map.size;
  }
}

const reportCache = new LRUCache(500);

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

// ---------- Fix #2: every listener has a guaranteed way out ----------
app.get('/subscribe', (req, res) => {
  const payload = Buffer.alloc(50 * 1024);

  const handler = () => {
    clearTimeout(timer);
    return payload.length;
  };

  // Safety net: if 'tick' never fires, remove the listener anyway.
  const timer = setTimeout(() => bus.off('tick', handler), 30_000);
  timer.unref();

  bus.once('tick', handler); // once() removes it after the first tick
  res.json({ subscribers: bus.listenerCount('tick') });
});

setInterval(() => bus.emit('tick'), 5_000).unref();

registerDebugRoutes(app, () => ({
  cacheEntries: reportCache.size,
  tickListeners: bus.listenerCount('tick'),
}));
registerErrorHandlers(app);
listen(app);