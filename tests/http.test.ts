import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { politeJson, politeText, HttpError, resetRateLimits, USER_AGENT } from '../src/connectors/http.js';

let server: Server;
let base = '';
let calls: { path: string; ua: string | undefined; at: number }[] = [];
let flaky = 0;

before(async () => {
  server = createServer((req, res) => {
    calls.push({ path: req.url ?? '', ua: req.headers['user-agent'], at: Date.now() });
    if (req.url === '/ok') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"jobs":[1,2]}'); return; }
    if (req.url === '/page') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<a href="https://jobs.lever.co/acme">Jobs</a>'); return; }
    if (req.url === '/blocked') { res.writeHead(429); res.end(); return; }
    if (req.url === '/flaky') {
      flaky++;
      if (flaky === 1) { res.writeHead(503); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  if (addr && typeof addr === 'object') base = `http://127.0.0.1:${addr.port}`;
});
after(() => server.close());

test('returns parsed JSON and sends the user-agent', async () => {
  calls = []; resetRateLimits();
  const data = await politeJson<{ jobs: number[] }>(`${base}/ok`, { gapMs: 10 });
  assert.deepEqual(data.jobs, [1, 2]);
  assert.equal(calls[0].ua, USER_AGENT);
});

test('spaces calls to the same host', async () => {
  calls = []; resetRateLimits();
  await Promise.all([politeJson(`${base}/ok`, { gapMs: 100 }), politeJson(`${base}/ok`, { gapMs: 100 })]);
  assert.ok(calls[1].at - calls[0].at >= 90, `gap was ${calls[1].at - calls[0].at}ms`);
});

test('429 throws a blocked HttpError without retrying', async () => {
  calls = []; resetRateLimits();
  await assert.rejects(politeJson(`${base}/blocked`, { gapMs: 10 }), (e: unknown) => {
    assert.ok(e instanceof HttpError && e.blocked);
    return true;
  });
  assert.equal(calls.length, 1);
});

test('retries once on a 5xx', async () => {
  calls = []; resetRateLimits(); flaky = 0;
  const data = await politeJson<{ ok: boolean }>(`${base}/flaky`, { gapMs: 10 });
  assert.equal(data.ok, true);
  assert.equal(calls.length, 2);
});

test('politeText returns HTML and the final URL', async () => {
  calls = []; resetRateLimits();
  const { text, finalUrl } = await politeText(`${base}/page`, { gapMs: 10 });
  assert.match(text, /jobs\.lever\.co\/acme/);
  assert.equal(finalUrl, `${base}/page`);
});
