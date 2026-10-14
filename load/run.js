import autocannon from 'autocannon';

const target = process.argv[2] ?? 'report';
const duration = Number(process.argv[3] ?? 15);

const randomId = () => Math.random().toString(36).slice(2);

const paths = {
  report: () => `/report?filter=${randomId()}`,
  subscribe: () => '/subscribe',
};

if (!paths[target]) {
  console.error(`Unknown target "${target}". Use: ${Object.keys(paths).join(', ')}`);
  process.exit(1);
}

let shown = false;
const showOnce = (label) => (err) => {
  if (!shown) {
    shown = true;
    console.error(`${label}:`, err?.message ?? err);
  }
};

const instance = autocannon({
  url: 'http://localhost:3000',
  connections: 20,
  duration,
  requests: [
    {
      method: 'GET',
      setupRequest: (req) => {
        req.path = paths[target]();
        return req;
      },
    },
  ],
});

instance.on('reqError', showOnce('reqError'));
instance.on('error', showOnce('error'));

const result = await instance;

console.log(
  `${target}: ${result.requests.total} requests, ` +
    `p99 latency ${result.latency.p99} ms, errors ${result.errors}`
);