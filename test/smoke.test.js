import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const DEV_PORT = 3191;
const PROD_PORT = 3192;
const servers = [];

async function startServer(port, env = {}) {
  const proc = spawn(process.execPath, ['src/server.fixed.js'], {
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servers.push(proc);

  // Keep the server output so a failure explains itself.
  let output = '';
  proc.stdout.on('data', (chunk) => { output += chunk; });
  proc.stderr.on('data', (chunk) => { output += chunk; });

  let exited = false;
  proc.on('exit', () => { exited = true; });

  // Poll over HTTP instead of parsing stdout: it works the same on every OS.
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`server on port ${port} exited early:\n${output}`);
    }
    try {
      const res = await fetch(`${url}/report?filter=ready`);
      if (res.ok) return url;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server on port ${port} was not ready after 10s:\n${output}`);
}

let dev;
let prod;

before(async () => {
  dev = await startServer(DEV_PORT, { NODE_ENV: 'development' });
  prod = await startServer(PROD_PORT, { NODE_ENV: 'production' });
});

after(() => {
  for (const proc of servers) {
    proc.kill();
  }
});



test('GET /report with a valid filter returns the report summary', async () => {
  const res = await fetch(`${dev}/report?filter=abc_123`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { key: '/report?filter=abc_123', rows: 200 });
});

test('GET /report rejects missing, repeated, oversized and unusual filters', async () => {
  const badQueries = [
    '',
    '?filter=a&filter=b',
    `?filter=${'x'.repeat(65)}`,
    '?filter=has space',
    '?filter=<script>',
  ];
  for (const query of badQueries) {
    const res = await fetch(`${dev}/report${query}`);
    assert.equal(res.status, 400, `expected 400 for "${query}"`);
  }
});

test('unknown routes return a JSON 404, not an HTML error page', async () => {
  const res = await fetch(`${dev}/does-not-exist`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await res.json(), { error: 'Not found' });
});

test('responses carry security headers and do not advertise Express', async () => {
  const res = await fetch(`${dev}/report?filter=a`);
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(res.headers.get('content-security-policy'));
});

test('debug endpoints are available outside production', async () => {
  const res = await fetch(`${dev}/debug/memory`);
  assert.equal(res.status, 200);
  const stats = await res.json();
  assert.equal(typeof stats.heapUsedMB, 'number');
});

test('debug endpoints do not exist in production', async () => {
  const memory = await fetch(`${prod}/debug/memory`);
  assert.equal(memory.status, 404);
  const snapshot = await fetch(`${prod}/debug/heap-snapshot`, { method: 'POST' });
  assert.equal(snapshot.status, 404);
});

test('the LRU cache never grows past its limit', async () => {
  for (let i = 0; i < 600; i++) {
    await fetch(`${dev}/report?filter=unique${i}`);
  }
  const stats = await (await fetch(`${dev}/debug/memory`)).json();
  assert.equal(stats.cacheEntries, 500);
});