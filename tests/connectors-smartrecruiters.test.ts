import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSmartRecruitersConnector, MAX_DETAILS } from '../src/connectors/smartrecruiters.js';
import { HttpError } from '../src/connectors/http.js';
import type { FetchJson } from '../src/connectors/greenhouse.js';
import { company } from './connectors-helpers.js';

type Page = { offset: number; limit: number; totalFound: number; content: { id: string }[] };
const listSample = JSON.parse(readFileSync('tests/samples/smartrecruiters/servicenow-postings.json', 'utf8')) as Page;
const details = JSON.parse(readFileSync('tests/samples/smartrecruiters/servicenow-details.json', 'utf8')) as Record<string, unknown>;

/** Serves the saved samples like the real API: paged list by offset, details by id. */
function fakeApi(pageSize = 100, onDetail?: (id: string) => unknown): { fetch: FetchJson; urls: string[] } {
  const urls: string[] = [];
  const fetch: FetchJson = async (url) => {
    urls.push(url);
    const u = new URL(url);
    const detailId = u.pathname.match(/\/postings\/([^/]+)$/)?.[1];
    if (detailId) return onDetail ? onDetail(detailId) : details[detailId];
    const offset = Number(u.searchParams.get('offset') ?? 0);
    return { ...listSample, offset, limit: pageSize, content: listSample.content.slice(offset, offset + pageSize) };
  };
  return { fetch, urls };
}

test('smartrecruiters: maps every sample posting with its details', async () => {
  const api = fakeApi();
  const jobs = await createSmartRecruitersConnector(api.fetch).fetchJobs(company('smartrecruiters', 'ServiceNow'));

  assert.equal(jobs.length, 5);
  assert.equal(api.urls[0], 'https://api.smartrecruiters.com/v1/companies/ServiceNow/postings?limit=100&offset=0');
  assert.equal(api.urls.length, 6);   // 1 list page + 5 details
  const swe = jobs.find((j) => j.externalId === '744000155374109');
  assert.ok(swe);
  assert.equal(swe.title, 'Staff Software Engineer');
  assert.equal(swe.location, 'Santa Clara, California, United States');
  assert.equal(swe.isRemote, false);
  assert.equal(swe.url, 'https://jobs.smartrecruiters.com/ServiceNow/744000155374109-staff-software-engineer');
  assert.equal(swe.postedAt, '2026-10-13T22:50:18Z');
  assert.ok(swe.raw);
  assert.equal(jobs.find((j) => j.externalId === '744000155353317')?.isRemote, true);
  assert.equal(jobs.find((j) => j.externalId === '744000155363900')?.location, 'London, United Kingdom');
});

test('smartrecruiters: description is plain text from all job ad sections', async () => {
  const jobs = await createSmartRecruitersConnector(fakeApi().fetch).fetchJobs(company('smartrecruiters', 'ServiceNow'));
  for (const j of jobs) {
    assert.ok(j.description && j.description.length > 200);
    assert.doesNotMatch(j.description, /<\/?[a-z][^>]*>/i);
    assert.match(j.description, /Job Description\n/);
    assert.match(j.description, /Qualifications\n/);
  }
});

test('smartrecruiters: follows pagination until totalFound', async () => {
  const api = fakeApi(2);
  const jobs = await createSmartRecruitersConnector(api.fetch, 0).fetchJobs(company('smartrecruiters', 'ServiceNow'));
  assert.equal(jobs.length, 5);
  assert.deepEqual(api.urls.map((u) => new URL(u).searchParams.get('offset')), ['0', '2', '4']);
});

test('smartrecruiters: details only for the newest N; the rest keep a fallback URL', async () => {
  const api = fakeApi();
  const jobs = await createSmartRecruitersConnector(api.fetch, 2).fetchJobs(company('smartrecruiters', 'ServiceNow'));
  assert.equal(api.urls.length, 3);
  assert.deepEqual(jobs.slice(0, 2).map((j) => j.externalId), ['744000155398439', '744000155375219']);
  assert.ok(jobs[0].description);
  assert.equal(jobs[4].description, null);
  assert.equal(jobs[4].url, `https://jobs.smartrecruiters.com/ServiceNow/${jobs[4].externalId}`);
  assert.equal(MAX_DETAILS, 50);
});

test('smartrecruiters: a failed detail leaves the description empty', async () => {
  const api = fakeApi(100, (id) => { throw new HttpError(404, id); });
  const jobs = await createSmartRecruitersConnector(api.fetch).fetchJobs(company('smartrecruiters', 'ServiceNow'));
  assert.equal(jobs.length, 5);
  assert.ok(jobs.every((j) => j.description === null));
});

test('smartrecruiters: a blocked detail call stops the company', async () => {
  const api = fakeApi(100, (id) => { throw new HttpError(429, id); });
  await assert.rejects(
    createSmartRecruitersConnector(api.fetch).fetchJobs(company('smartrecruiters', 'ServiceNow')),
    (e: unknown) => e instanceof HttpError && e.blocked,
  );
  assert.equal(api.urls.length, 2);
});

test('smartrecruiters: empty company returns no jobs', async () => {
  const empty = async () => ({ offset: 0, limit: 100, totalFound: 0, content: [] });
  const jobs = await createSmartRecruitersConnector(empty).fetchJobs(company('smartrecruiters', 'Nobody'));
  assert.deepEqual(jobs, []);
});

test('smartrecruiters: HttpError on the list is passed up', async () => {
  const failing: FetchJson = async (url) => { throw new HttpError(500, url); };
  await assert.rejects(
    createSmartRecruitersConnector(failing).fetchJobs(company('smartrecruiters', 'ServiceNow')),
    (e: unknown) => e instanceof HttpError && e.status === 500,
  );
});
