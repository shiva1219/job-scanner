import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createGreenhouseConnector, greenhouseUrl, stripHtml, decodeEntities, toIsoUtc,
} from '../src/connectors/greenhouse.js';
import { HttpError } from '../src/connectors/http.js';
import { company } from './connectors-helpers.js';

const sample: unknown = JSON.parse(readFileSync('tests/samples/greenhouse/pinterest.json', 'utf8'));

test('greenhouse: maps every sample job', async () => {
  const urls: string[] = [];
  const gh = createGreenhouseConnector(async (url) => { urls.push(url); return sample; });
  const jobs = await gh.fetchJobs(company('greenhouse', 'pinterest'));

  assert.deepEqual(urls, ['https://boards-api.greenhouse.io/v1/boards/pinterest/jobs?content=true']);
  assert.equal(jobs.length, 5);
  const first = jobs[0];
  assert.equal(first.title, 'Machine Learning Engineer, Core Engineering');
  assert.match(first.externalId, /^\d+$/);
  assert.match(first.url, /^https:\/\/www\.pinterestcareers\.com\/jobs\/\?gh_jid=\d+$/);
  assert.match(first.location ?? '', /Remote, US/);
  assert.equal(first.isRemote, true);
  assert.match(first.postedAt ?? '', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.ok(first.raw);
  assert.equal(jobs.find((j) => j.location === 'Dublin, IE')?.isRemote, false);
});

test('greenhouse: description is plain text, no tags or entities', async () => {
  const jobs = await createGreenhouseConnector(async () => sample).fetchJobs(company('greenhouse', 'pinterest'));
  for (const j of jobs) {
    assert.ok(j.description && j.description.length > 200);
    assert.doesNotMatch(j.description, /<\/?[a-z][^>]*>/i);
    assert.doesNotMatch(j.description, /&(lt|gt|amp|quot|nbsp|#\d+);/);
  }
  assert.match(jobs[0].description ?? '', /About Pinterest/);
});

test('greenhouse: empty board returns no jobs', async () => {
  const jobs = await createGreenhouseConnector(async () => ({ jobs: [], meta: { total: 0 } }))
    .fetchJobs(company('greenhouse', 'empty'));
  assert.deepEqual(jobs, []);
});

test('greenhouse: HttpError from the board is passed up', async () => {
  const gh = createGreenhouseConnector(async (url) => { throw new HttpError(404, url); });
  await assert.rejects(gh.fetchJobs(company('greenhouse', 'nope')), (e: unknown) => e instanceof HttpError && e.status === 404);
});

test('greenhouse: missing atsId is a clear error', async () => {
  const gh = createGreenhouseConnector(async () => sample);
  await assert.rejects(gh.fetchJobs(company('greenhouse', null)), /atsId is not set/);
});

test('greenhouseUrl encodes the board token', () => {
  assert.equal(greenhouseUrl('a b'), 'https://boards-api.greenhouse.io/v1/boards/a%20b/jobs?content=true');
});

test('stripHtml: tags, lists, entities and whitespace', () => {
  const html = '<h2>Role</h2><p>Build&nbsp;UI &amp; APIs&#39;</p><ul><li>React</li><li>Node</li></ul><script>x()</script><br/>Done';
  assert.equal(stripHtml(html), "Role\nBuild UI & APIs'\n\n- React\n- Node\n\nDone");
  assert.equal(stripHtml('<p> </p>'), null);
  assert.equal(stripHtml(null), null);
  assert.equal(stripHtml(decodeEntities('&lt;p&gt;a &amp;lt; b&lt;/p&gt;')), 'a < b');
});

test('toIsoUtc: offsets, epoch ms and junk', () => {
  assert.equal(toIsoUtc('2026-10-06T08:14:26-04:00'), '2026-10-06T12:14:26Z');
  assert.equal(toIsoUtc(1782214185805), '2026-06-23T11:29:45Z');
  assert.equal(toIsoUtc('not a date'), null);
  assert.equal(toIsoUtc(null), null);
});
