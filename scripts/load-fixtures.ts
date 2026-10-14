// Loads the 20 sample jobs into the database. Safe to rerun.
// Usage: npm run db:fixtures
import { readFileSync } from 'node:fs';
import { openDb } from '../src/db/index.js';
import { loadFixtures, type FixtureJob } from '../src/db/seed.js';

const db = openDb();
const fixtures: FixtureJob[] = JSON.parse(readFileSync('fixtures/jobs.json', 'utf8'));
const added = loadFixtures(db, fixtures);
const { count } = db.prepare('SELECT COUNT(*) AS count FROM jobs').get() as { count: number };
console.log(`Loaded ${fixtures.length} sample jobs (${added} new). Jobs in database: ${count}`);
