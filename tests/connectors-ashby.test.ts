import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAshbyConnector, mapAshbyJob } from '../src/connectors/ashby.js';
import { HttpError } from '../src/connectors/http.js';
import { company } from './connectors-helpers.js';

const sample = JSON.parse(readFileSync('tests/samples/ashby/plaid.json', 'utf8')) as { jobs: Record<string, unknown>[] };

test('ashby: maps every sample job', async () => {
  const urls: string[] = [];
  const ashby = createAshbyConnector(async (url) => { urls.push(url); return sample; });
  const jobs = await ashby.fetchJobs(company('ashby', 'plaid'));

  assert.deepEqual(urls, ['https://api.ashbyhq.com/posting-api/job-board/plaid']);
  assert.equal(jobs.length, 5);
  const em = jobs.find((j) => j.externalId === '21d70dd3-3884-4c90-915d-ace885ddb245');
  assert.ok(em);
  assert.equal(em.title, 'Engineering Manager - Personal Finance');
  assert.equal(em.location, 'New York City Office');
  assert.equal(em.url, 'https://jobs.ashbyhq.com/plaid/21d70dd3-3884-4c90-915d-ace885ddb245');
  assert.equal(em.postedAt, '2026-09-30T15:52:09Z');
  assert.ok(em.raw);
});

test('ashby: Remote is remote; Hybrid with isRemote=true is not', async () => {
  const jobs = await createAshbyConnector(async () => sample).fetchJobs(company('ashby', 'plaid'));
  const byId = new Map(jobs.map((j) => [j.externalId, j.isRemote]));
  assert.equal(byId.get('c0368ca1-8a7d-4212-b41e-4ed71a83c601'), true);   // Remote
  assert.equal(byId.get('21d70dd3-3884-4c90-915d-ace885ddb245'), false);  // Hybrid
  assert.equal(byId.get('4cc6c985-40cc-472f-94cd-90807c698b50'), false);  // OnSite
});

test('ashby: description is plain text', async () => {
  const jobs = await createAshbyConnector(async () => sample).fetchJobs(company('ashby', 'plaid'));
  for (const j of jobs) {
    assert.ok(j.description && j.description.length > 200);
    assert.doesNotMatch(j.description, /<\/?[a-z][^>]*>/i);
    assert.doesNotMatch(j.description, /&(lt|gt|amp|quot|nbsp|#\d+);/);
  }
});

test('ashby: secondary locations, null workplaceType and unlisted jobs', () => {
  const base = sample.jobs[1];
  const multi = mapAshbyJob({
    ...base, workplaceType: null, isRemote: true,
    secondaryLocations: [{ location: 'Seattle Office' }, { location: 'Remote - US' }],
  });
  assert.equal(multi?.location, 'New York City Office; Seattle Office; Remote - US');
  assert.equal(multi?.isRemote, true);
  assert.equal(mapAshbyJob({ ...base, isListed: false }), null);
});

test('ashby: empty board returns no jobs', async () => {
  const jobs = await createAshbyConnector(async () => ({ jobs: [], apiVersion: '1' })).fetchJobs(company('ashby', 'empty'));
  assert.deepEqual(jobs, []);
});

test('ashby: HttpError is passed up', async () => {
  const ashby = createAshbyConnector(async (url) => { throw new HttpError(429, url); });
  await assert.rejects(ashby.fetchJobs(company('ashby', 'busy')), (e: unknown) => e instanceof HttpError && e.blocked);
});
