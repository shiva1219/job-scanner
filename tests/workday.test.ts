import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createWorkdayConnector, parsePostedOn, parseDetail, htmlToText, tenantOf, SEARCHES, type FetchJson,
} from '../src/connectors/workday.js';
import { HttpError, type PoliteOptions } from '../src/connectors/http.js';
import type { Company } from '../src/db/types.js';

// Real responses saved 2026-10-13 (facets dropped, descriptions cut to 1500 chars).
const sample = (name: string): unknown => JSON.parse(readFileSync(`tests/samples/workday/${name}.json`, 'utf8'));
const TODAY = new Date('2026-10-13T15:00:00Z');
const EMPTY = { total: 0, jobPostings: [] };

function company(host: string, site: string): Company {
  return {
    id: 1, name: 'Test Co', priority: 'A', sector: null, hubs: null, pathFit: null, careerUrl: null,
    ats: 'workday', atsId: null, workdayHost: host, workdaySite: site, atsVerified: false, active: true,
  };
}

interface Call { url: string; opts?: PoliteOptions }

/** Fake politeJson: list pages keyed by "searchText@offset", details keyed by externalPath suffix. */
function fakeFetch(lists: Record<string, unknown>, details: Record<string, unknown> = {}, calls: Call[] = []): FetchJson {
  return async <T>(url: string, opts?: PoliteOptions): Promise<T> => {
    calls.push({ url, opts });
    if (opts?.method === 'POST') {
      const body = opts.body as { searchText: string; offset: number; limit: number };
      return (lists[`${body.searchText}@${body.offset}`] ?? EMPTY) as T;
    }
    const key = Object.keys(details).find((k) => url.endsWith(k));
    if (!key) throw new HttpError(404, url);
    const d = details[key];
    if (d instanceof Error) throw d;
    return d as T;
  };
}

const NV = company('nvidia.wd5.myworkdayjobs.com', 'NVIDIAExternalCareerSite');
const NV_LISTS = {
  'frontend@0': sample('nvidia-list-frontend-0'),
  'frontend@20': sample('nvidia-list-frontend-20'),
  'front end@0': sample('nvidia-list-front-end-0'),
};

test('tenant is the first label of the host', () => {
  assert.equal(tenantOf('capitalone.wd12.myworkdayjobs.com'), 'capitalone');
});

test('pages through results using the total from page 1', async () => {
  const calls: Call[] = [];
  const jobs = await createWorkdayConnector({ fetchJson: fakeFetch({
    'frontend@0': sample('nvidia-list-frontend-0'), 'frontend@20': sample('nvidia-list-frontend-20'),
  }, {}, calls), maxDetails: 0 }).fetchJobs(NV);
  assert.equal(jobs.length, 37);
  const frontendCalls = calls.filter((c) => (c.opts?.body as { searchText: string }).searchText === 'frontend');
  assert.deepEqual(frontendCalls.map((c) => (c.opts?.body as { offset: number }).offset), [0, 20]);
  assert.equal(calls[0].url, 'https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs');
  assert.deepEqual(calls[0].opts?.body, { appliedFacets: {}, limit: 20, offset: 0, searchText: 'frontend' });
});

test('runs every search once and deduplicates by externalPath', async () => {
  const calls: Call[] = [];
  const jobs = await createWorkdayConnector({ fetchJson: fakeFetch(NV_LISTS, {}, calls), maxDetails: 0 }).fetchJobs(NV);
  // 37 "frontend" + 20 "front end" on page 1, one posting in both.
  assert.equal(jobs.length, 56);
  assert.equal(new Set(jobs.map((j) => j.externalId)).size, 56);
  const searched = [...new Set(calls.map((c) => (c.opts?.body as { searchText: string }).searchText))];
  assert.deepEqual(searched.sort(), [...SEARCHES].sort());
});

test('stops at the job cap', async () => {
  const jobs = await createWorkdayConnector({ fetchJson: fakeFetch(NV_LISTS), maxJobs: 25, maxDetails: 0 }).fetchJobs(NV);
  assert.equal(jobs.length, 25);
});

test('limits detail calls and gives them to frontend-looking titles first', async () => {
  const calls: Call[] = [];
  const jobs = await createWorkdayConnector({ fetchJson: fakeFetch(NV_LISTS, {}, calls), maxDetails: 5 }).fetchJobs(NV);
  const detailCalls = calls.filter((c) => c.opts?.method !== 'POST');
  assert.equal(detailCalls.length, 5);
  const byPath = new Map(jobs.map((j) => [j.externalId, j.title]));
  for (const c of detailCalls) {
    const path = c.url.slice(c.url.indexOf('/job/'));
    assert.match(byPath.get(path) ?? '', /front|full|web|ui|react|angular|javascript|typescript/i);
  }
});

test('postedOn relative text becomes an approximate ISO date', () => {
  assert.equal(parsePostedOn('Posted Today', TODAY), '2026-10-13T00:00:00Z');
  assert.equal(parsePostedOn('Posted Yesterday', TODAY), '2026-10-12T00:00:00Z');
  assert.equal(parsePostedOn('Posted 3 Days Ago', TODAY), '2026-10-10T00:00:00Z');
  assert.equal(parsePostedOn('Posted 19 Days Ago', TODAY), '2026-09-24T00:00:00Z');
  assert.equal(parsePostedOn('Posted 30+ Days Ago', TODAY), null);
  assert.equal(parsePostedOn('Something else', TODAY), null);
  assert.equal(parsePostedOn(null, TODAY), null);
});

test('maps a detail response (Citi) to a FetchedJob', async () => {
  const lists = { 'frontend@0': sample('citi-list-frontend-0') };
  const details = { 'Frontend-Engineer-Angular_26967876': sample('citi-detail') };
  const jobs = await createWorkdayConnector({ fetchJson: fakeFetch(lists, details), now: () => TODAY, maxDetails: 1 })
    .fetchJobs(company('citi.wd5.myworkdayjobs.com', '2'));
  const j = jobs.find((x) => x.title === 'Frontend Engineer Angular');
  assert.ok(j);
  assert.equal(j.externalId, '/job/Jacksonville-Florida-United-States/Frontend-Engineer-Angular_26967876');
  assert.equal(j.url, 'https://citi.wd5.myworkdayjobs.com/2/job/Jacksonville-Florida-United-States/Frontend-Engineer-Angular_26967876');
  assert.equal(j.location, 'Jacksonville Florida United States');
  assert.equal(j.postedAt, '2026-08-17T00:00:00Z', 'detail startDate beats "30+ Days Ago"');
  assert.equal(j.isRemote, false);
  assert.ok(j.description && j.description.length > 100);
  assert.doesNotMatch(j.description, /<[a-z/][^>]*>/i);
});

test('uses the detail externalUrl even on another host (Fidelity, myworkdaysite.com)', async () => {
  const lists = { 'frontend@0': sample('fidelity-list-frontend-0') };
  const details = { 'Principal-Full-Stack-Engineer_2125564-2': sample('fidelity-detail') };
  const jobs = await createWorkdayConnector({ fetchJson: fakeFetch(lists, details), now: () => TODAY, maxDetails: 1 })
    .fetchJobs(company('fmr.wd1.myworkdayjobs.com', 'FidelityCareers'));
  const j = jobs.find((x) => x.title === 'Principal Full Stack Engineer');
  assert.equal(j?.url, 'https://wd1.myworkdaysite.com/recruiting/fmr/FidelityCareers/job/300-New-Millennium-Way-Durham-NC/Principal-Full-Stack-Engineer_2125564-2');
  assert.equal(j?.postedAt, '2026-10-12T00:00:00Z');
});

test('without a detail, builds the URL and date from the list row', async () => {
  const jobs = await createWorkdayConnector({
    fetchJson: fakeFetch({ 'frontend@0': sample('fidelity-list-frontend-0') }), now: () => TODAY, maxDetails: 0,
  }).fetchJobs(company('fmr.wd1.myworkdayjobs.com', 'FidelityCareers'));
  const j = jobs[0];
  assert.ok(j.url.startsWith('https://fmr.wd1.myworkdayjobs.com/FidelityCareers/job/'));
  assert.equal(j.postedAt, '2026-10-12T00:00:00Z');
  assert.equal(j.description, null);
});

test('a failed detail call keeps the job without a description', async () => {
  const jobs = await createWorkdayConnector({
    fetchJson: fakeFetch({ 'frontend@0': sample('citi-list-frontend-0') }, { 'Frontend-Engineer-Angular_26967876': new HttpError(500, 'x') }),
    now: () => TODAY, maxDetails: 1,
  }).fetchJobs(company('citi.wd5.myworkdayjobs.com', '2'));
  assert.equal(jobs.length, 3);
  assert.ok(jobs.every((j) => j.description === null));
});

test('a blocked (429) list call stops the company with a blocked HttpError', async () => {
  const blocked: FetchJson = async (url) => { throw new HttpError(429, url); };
  await assert.rejects(createWorkdayConnector({ fetchJson: blocked }).fetchJobs(NV),
    (e: unknown) => e instanceof HttpError && e.blocked);
});

test('a blocked (429) detail call also stops the company', async () => {
  const fetchJson = fakeFetch({ 'frontend@0': sample('citi-list-frontend-0') },
    { 'Frontend-Engineer-Angular_26967876': new HttpError(429, 'x') });
  await assert.rejects(createWorkdayConnector({ fetchJson, maxDetails: 1 }).fetchJobs(company('citi.wd5.myworkdayjobs.com', '2')),
    (e: unknown) => e instanceof HttpError && e.status === 429);
});

test('throws if workday_host or workday_site is missing', async () => {
  const c = { ...NV, workdaySite: null };
  await assert.rejects(createWorkdayConnector({ fetchJson: fakeFetch({}) }).fetchJobs(c), /workday_site/);
});

test('parseDetail returns null for an unexpected payload', () => {
  assert.equal(parseDetail({ error: 'nope' }), null);
  assert.equal(parseDetail(null), null);
});

test('htmlToText keeps paragraphs and list items readable', () => {
  assert.equal(htmlToText('<p>Build&nbsp;UIs &amp; APIs</p><ul><li>React</li><li>Node</li></ul>'),
    'Build UIs & APIs\n- React\n- Node');
});

test('remote is detected from the location text', async () => {
  const list = { total: 1, jobPostings: [{ title: 'Web Engineer', externalPath: '/job/Remote-USA/Web-Engineer_R1', locationsText: 'Remote - USA', postedOn: 'Posted Today' }] };
  const jobs = await createWorkdayConnector({ fetchJson: fakeFetch({ 'frontend@0': list }), now: () => TODAY, maxDetails: 0 }).fetchJobs(NV);
  assert.equal(jobs[0].isRemote, true);
});
