import express from 'express';
import { EventEmitter } from 'node:events';
import { writeHeapSnapshot } from 'node:v8';
import { mkdirSync } from 'node:fs';


const app = express();
const bus = new EventEmitter();

// ----------- Leak #1: cache with no upper bound -------------
const reportCache = new Map();

function buildReport(filter) 
{
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

// ------------ Leak #2: listeners that are never removed ---------------
app.get('/subscribe', (req, res) => {
    const payload = Buffer.alloc(50 * 1024); // 50kb per subscriber
    bus.on('tick', () => payload.length);    // closure keeps `payload` alive
    res.json({ subscribers: bus.listenerCount('tick') });
});

setInterval(() => bus.emit('tick'), 5_000).unref();

// -------------- Debug endpoints -----------------
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