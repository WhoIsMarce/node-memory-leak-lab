import express from 'express';
import { EventEmitter } from 'node:events';
import { writeHeapSnapshot } from 'node:v8';
import { mkdirSync } from 'node:fs';

const app = express();
const bus = new EventEmitter();

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

app.get('/report', (req, res) => {
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

// ---------- Debug endpoints ----------
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
    cacheEntries: reportCache.size,
    tickListeners: bus.listenerCount('tick'),
  });
});

app.post('/debug/heap-snapshot', (_req, res) => {
  mkdirSync('snapshots', { recursive: true });
  const file = writeHeapSnapshot(`snapshots/heap-${Date.now()}.heapsnapshot`);
  res.json({ file });
});

app.listen(3000, (err) => {
  if (err) {
    console.error('Could not start server:', err.message);
    process.exit(1);
  }
  console.log('Listening on http://localhost:3000');
});