import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb } from '../src/db/index.js';
import { seedCompanies, loadFixtures, saveJobs, type FixtureJob } from '../src/db/seed.js';

const csv = readFileSync('companies.csv', 'utf8');
const fixtures: FixtureJob[] = JSON.parse(readFileSync('fixtures/jobs.json', 'utf8'));

function freshDb() {
  const db = openDb(':memory:');
  seedCompanies(db, csv);
  return db;
}

test('seeds all 100 companies, and reseeding does not duplicate', () => {
  const db = freshDb();
  seedCompanies(db, csv);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM companies').get() as { n: number };
  assert.equal(n, 100);
});

test('loads 20 sample jobs, and reloading adds none', () => {
  const db = freshDb();
  assert.equal(loadFixtures(db, fixtures), 20);
  assert.equal(loadFixtures(db, fixtures), 0);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number };
  assert.equal(n, 20);
});

test('every sample job has a description hash', () => {
  const db = freshDb();
  loadFixtures(db, fixtures);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE description_hash IS NULL').get() as { n: number };
  assert.equal(n, 0);
});

test('a reopened posting clears closed_at', () => {
  const db = freshDb();
  loadFixtures(db, fixtures);
  db.prepare("UPDATE jobs SET closed_at = '2026-10-13T00:00:00Z' WHERE external_id = 'CO-1001'").run();
  const { id } = db.prepare("SELECT id FROM companies WHERE name = 'Capital One'").get() as { id: number };
  const { company, expected, ...job } = fixtures[0];
  saveJobs(db, id, [job]);
  const row = db.prepare("SELECT closed_at FROM jobs WHERE external_id = 'CO-1001'").get() as { closed_at: string | null };
  assert.equal(row.closed_at, null);
});

test('the same posting cannot be scored twice for one prompt version', () => {
  const db = freshDb();
  loadFixtures(db, fixtures);
  const insert = db.prepare(`INSERT INTO scores (job_id, scorer, prompt_version, description_hash, fit_score, verdict)
                             VALUES (1, 'claude-code', 'v1', 'h', 85, 'APPLY')`);
  insert.run();
  assert.throws(() => insert.run(), /UNIQUE/);
});

test('shortlist view returns filter-passed jobs with their latest score', () => {
  const db = freshDb();
  loadFixtures(db, fixtures);
  db.prepare("INSERT INTO filter_results (job_id, filter_version, passed) VALUES (1, 'v1', 1)").run();
  db.prepare(`INSERT INTO scores (job_id, scorer, prompt_version, description_hash, fit_score, verdict, scored_at)
              VALUES (1, 'claude-code', 'v1', 'h1', 70, 'APPLY_WITH_REFERRAL', '2026-10-13T00:00:00Z'),
                     (1, 'claude-code', 'v2', 'h1', 88, 'APPLY', '2026-10-14T00:00:00Z')`).run();
  const rows = db.prepare('SELECT job_id, fit_score, verdict, status FROM v_shortlist').all() as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fit_score, 88);
  assert.equal(rows[0].verdict, 'APPLY');
  assert.equal(rows[0].status, 'new');
});

test('invalid values are rejected by the schema', () => {
  const db = freshDb();
  loadFixtures(db, fixtures);
  assert.throws(() => db.prepare(`INSERT INTO scores (job_id, scorer, prompt_version, description_hash, fit_score, verdict)
                                  VALUES (1, 'claude-code', 'v1', 'x', 150, 'APPLY')`).run(), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO applications (job_id, status) VALUES (1, 'maybe')").run(), /CHECK/);
});
