import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLeverConnector } from '../src/connectors/lever.js';
import { HttpError } from '../src/connectors/http.js';
import { company } from './connectors-helpers.js';

const sample: unknown = JSON.parse(readFileSync('tests/samples/lever/spotify.json', 'utf8'));

test('lever: maps every sample posting', async () => {
  const urls: string[] = [];
  const lever = createLeverConnector(async (url) => { urls.push(url); return sample; });
  const jobs = await lever.fetchJobs(company('lever', 'spotify'));

  assert.deepEqual(urls, ['https://api.lever.co/v0/postings/spotify?mode=json']);
  assert.equal(jobs.length, 5);
  const android = jobs.find((j) => j.externalId === '2193db3f-77c5-43b8-b030-8f92c9882bf1');
  assert.ok(android);
  assert.equal(android.title, 'Android Engineer - Experience');
  assert.equal(android.location, 'London; Stockholm');
  assert.equal(android.isRemote, false);
  assert.equal(android.url, 'https://jobs.lever.co/spotify/2193db3f-77c5-43b8-b030-8f92c9882bf1');
  assert.equal(android.postedAt, '2026-06-23T11:29:45Z');
  assert.ok(android.raw);
});

test('lever: workplaceType remote marks the job remote', async () => {
  const jobs = await createLeverConnector(async () => sample).fetchJobs(company('lever', 'spotify'));
  const remote = jobs.find((j) => j.externalId === '4310f31c-90e1-4e8d-bdcf-dce39c145b8c');
  assert.equal(remote?.isRemote, true);
  assert.equal(remote?.location, 'New York, NY');
});

test('lever: description joins intro, lists and closing as plain text', async () => {
  const jobs = await createLeverConnector(async () => sample).fetchJobs(company('lever', 'spotify'));
  for (const j of jobs) {
    assert.ok(j.description && j.description.length > 200);
    assert.doesNotMatch(j.description, /<\/?[a-z][^>]*>/i);
    assert.match(j.description, /What You'll Do\n/);
    assert.match(j.description, /\n- \S/);
  }
});

test('lever: empty site returns no jobs', async () => {
  const jobs = await createLeverConnector(async () => []).fetchJobs(company('lever', 'empty'));
  assert.deepEqual(jobs, []);
});

test('lever: HttpError is passed up', async () => {
  const lever = createLeverConnector(async (url) => { throw new HttpError(404, url); });
  await assert.rejects(lever.fetchJobs(company('lever', 'gone')), (e: unknown) => e instanceof HttpError && e.status === 404);
});

test('lever: postings without id or URL are skipped', async () => {
  const jobs = await createLeverConnector(async () => [{ text: 'No id' }, { id: 'x', text: 'No url' }])
    .fetchJobs(company('lever', 'odd'));
  assert.deepEqual(jobs, []);
});
