# node-memory-leak-lab

A small Express service with two classic memory leaks, plus the tooling to
reproduce them under load, find them with heap snapshots, and verify the fix.

This repository accompanies the article
**"Finding and Fixing Memory Leaks in a Long-Running Node.js Service with Heap Snapshots"**
(link: _add the article URL here_).

## The two leaks

| Endpoint | Leak | Fix |
| --- | --- | --- |
| `GET /report` | Cache with no upper bound: every unique URL adds an entry forever | LRU cache limited to 500 entries |
| `GET /subscribe` | `EventEmitter` listeners that are never removed | `once()` plus a timeout as a safety net |

## Requirements

- Node.js 20 or later (tested on Node.js 22, on Windows with Git Bash and on Linux)
- npm
- Google Chrome (to open the heap snapshots in DevTools)

## Setup

```bash
git clone <your-repo-url>
cd node-memory-leak-lab
npm install
```

## How to work with this lab

Use **two terminals** and keep their roles fixed:

- **Terminal 1** runs the server. Start it and leave it alone.
- **Terminal 2** runs every other command (`curl`, load tests).

Never start the server in both terminals. If port 3000 is busy, the server
prints `Could not start server: listen EADDRINUSE` and exits.

## Run the leaky version

Terminal 1:

```bash
npm start
```

It must print `Listening on http://localhost:3000` and stay running.

Terminal 2, in this order:

```bash
curl -s localhost:3000/debug/memory
curl -s -X POST localhost:3000/debug/heap-snapshot
node load/run.js report 4
node load/run.js subscribe 3
curl -s localhost:3000/debug/memory
curl -s -X POST localhost:3000/debug/heap-snapshot
```

The first call must show `cacheEntries: 0` and `tickListeners: 0`. If it does
not, restart the server so the baseline is clean. Both load runs must report
`non-2xx 0`.

### Example results

Numbers vary by machine. These come from one run on Windows:

| Metric | Before | After |
| --- | --- | --- |
| `heapUsedMB` | 7.1 | 56.0 |
| `arrayBuffersMB` | 0 | 99.7 |
| `cacheEntries` | 0 | 2,369 |
| `tickListeners` | 0 | 2,042 |

Two snapshot files are written to `snapshots/`: the first is the baseline,
the second is taken after the load.

> Taking a heap snapshot blocks the process while it runs, and the file can
> reach hundreds of MB under heavy load. Never do it on an instance that is
> serving production traffic.

## Analyze the snapshots in Chrome DevTools

1. Open DevTools in any tab (`Ctrl` + `Shift` + `I`, or `Fn` + `F12` on many laptops).
2. Go to the **Memory** tab. If it is hidden, open the `»` menu.
3. Click **Load profile** and load both files from `snapshots/`, oldest first.
4. Select the second snapshot and change the view from _Summary_ to **Comparison**.
   Pick the first snapshot as the baseline.
5. Sort by **Size delta**. Use **Filter by class** to look at a single
   constructor, for example `filter` or `Buffer`.
6. Expand a constructor, select one object and read the **Retainers** panel.
   It shows the chain that keeps the object alive: for the cached reports it
   ends at a `Map` held by the variable `reportCache`, and for the buffers it
   goes through the `{tick}` listener array.

## Run the fixed version

Stop the leaky server first (`Ctrl+C` in terminal 1).

Terminal 1:

```bash
npm run start:fixed
```

Terminal 2. First check that the `/report` route works:

```bash
curl -s "localhost:3000/report?filter=a"
curl -s "localhost:3000/report?filter=b"
curl -s localhost:3000/debug/memory
```

You should see two JSON responses and `cacheEntries: 2`. Then run the load:

```bash
node load/run.js report 15
node load/run.js subscribe 15
curl -s localhost:3000/debug/memory
sleep 6
curl -s localhost:3000/debug/memory
sleep 2
curl -s localhost:3000/debug/memory
```

Expected: `cacheEntries` stays at 500 no matter how many requests you send,
`tickListeners` drops to 0 once the next 5-second tick fires, and
`arrayBuffersMB` reaches 0 within a couple of readings (Node frees those
buffers with a small delay).

Example results from the same Windows machine, with 18,798 requests to
`/report` and 21,539 to `/subscribe`:

| Moment | `heapUsedMB` | `cacheEntries` | `tickListeners` | `arrayBuffersMB` |
| --- | --- | --- | --- | --- |
| Before the load | 7.2 | 2 | 0 | 0 |
| Right after the load | 17.4 | 500 | 0* | 69.8 |
| 6 seconds later | 17.0 | 500 | 0 | 0 |

\* The 5-second tick had just fired, so this reading missed the peak.

`heapUsedMB` settles near 17 MB because the 500 cached reports are still in
memory. A `MaxListenersExceededWarning` in the server terminal is expected
during this test: thousands of legitimate subscribers wait for the next tick.

## Project layout

```text
src/server.js         # service with the two leaks
src/server.fixed.js   # same service with both fixes applied
load/run.js           # load generator built on autocannon
```

## Troubleshooting

- **`EADDRINUSE`**: another process is using port 3000. Find it and stop it.
  On Windows with Git Bash: `netstat -ano | grep :3000`, then
  `taskkill //PID <pid> //F`. On Linux or macOS: `lsof -i :3000`, then `kill <pid>`.
- **`Cannot GET /report` or a load run with `non-2xx` above 0**: the route is
  missing or the server is not the one you expect. A load tool counts a 404 as
  a valid response, so `errors 0` alone does not prove the test is real.
- **Server fails to start with an unexpected `import`**: an editor auto-import
  may have added a line at the top of the file. The file should start with
  exactly four imports: `express`, `node:events`, `node:v8` and `node:fs`.

## Notes

- The `/debug/*` endpoints and the `--expose-gc` flag are lab instrumentation.
  Do not ship them to production.
- Numbers vary by machine. Compare before and after on your own hardware.
- RSS can stay high after the fix on some systems (it did on Linux) and drop
  back to near the starting value on others (it did on Windows). Judge the fix
  by `heapUsed` and `arrayBuffers`, not by RSS.
- In Express 5, the `app.listen` callback also runs when the server emits an
  error, so `server.js` checks the `err` argument before logging success.

## License
