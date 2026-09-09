// Zero-dependency tests: `node --test` with native type stripping, so the SDK
// stays free of a test-runner toolchain.
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {AnalyticsClient, clampLimit, PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX} from './analytics.ts';

const BASE = 'http://analytics.test/api/v1';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

test('calls global fetch with the global as receiver', async () => {
  // Regression: storing `globalThis.fetch` bare and invoking it as
  // `this.fetchImpl(...)` makes the client instance the receiver, which browsers
  // reject with "Illegal invocation". The throw is indistinguishable from a dead
  // backend, so the UI silently showed "unavailable" against a healthy API.
  const original = globalThis.fetch;
  let receiver: unknown = 'never called';
  globalThis.fetch = function (this: unknown) {
    receiver = this;
    return Promise.resolve(jsonResponse({data: {totalPairs: 7}}));
  } as typeof fetch;

  try {
    const res = await new AnalyticsClient({baseUrl: BASE}).stats();
    assert.equal(res.ok, true);
    assert.ok(
      receiver === globalThis || receiver === undefined,
      `fetch receiver must be the global, got ${String(receiver)}`,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('reports unconfigured without touching the network', async () => {
  let called = false;
  const client = new AnalyticsClient({
    fetchImpl: () => {
      called = true;
      return Promise.resolve(jsonResponse({data: {}}));
    },
  });

  assert.equal(client.configured, false);
  const res = await client.stats();
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.reason, 'unconfigured');
  assert.equal(called, false, 'an unconfigured client must not make requests');
});

test('classifies a network failure as unreachable, not a crash', async () => {
  const client = new AnalyticsClient({
    baseUrl: BASE,
    fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
  });

  const res = await client.stats();
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.reason, 'unreachable');
});

test('surfaces an HTTP error status rather than throwing', async () => {
  const client = new AnalyticsClient({
    baseUrl: BASE,
    fetchImpl: () => Promise.resolve(jsonResponse({error: {code: 'boom'}}, 503)),
  });

  const res = await client.stats();
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.reason, 'error');
});

test('rejects a body that is not shaped like an API response', async () => {
  const client = new AnalyticsClient({
    baseUrl: BASE,
    fetchImpl: () => Promise.resolve(jsonResponse({unexpected: true})),
  });

  const res = await client.stats();
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.message, 'Malformed analytics response');
});

test('drops empty params and keeps the base path', async () => {
  let seen = '';
  const client = new AnalyticsClient({
    baseUrl: `${BASE}/`, // trailing slash must not double up
    fetchImpl: (input) => {
      seen = String(input);
      return Promise.resolve(jsonResponse({data: [], pagination: {}}));
    },
  });

  await client.pairs({limit: 10, token: undefined});
  assert.ok(seen.startsWith(`${BASE}/pairs?`), `unexpected url: ${seen}`);
  assert.match(seen, /limit=10/);
  assert.doesNotMatch(seen, /token=/);
});

test('clamps paging to the server limits (llm.txt s47)', () => {
  assert.equal(clampLimit(undefined), PAGE_LIMIT_DEFAULT);
  assert.equal(clampLimit(0), PAGE_LIMIT_DEFAULT);
  assert.equal(clampLimit(-5), PAGE_LIMIT_DEFAULT);
  assert.equal(clampLimit(1_000), PAGE_LIMIT_MAX);
  assert.equal(clampLimit(10.7), 10);
});
