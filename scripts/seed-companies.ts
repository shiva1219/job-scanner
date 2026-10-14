// Loads companies.csv into the companies table. Safe to rerun: updates existing rows by name.
// Usage: npx tsx scripts/seed-companies.ts [path/to/companies.csv]
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { openDb } from '../src/db/index.js';
import type { Ats } from '../src/db/types.js';

const ATS_MAP: Record<string, Ats> = {
  workday: 'workday', greenhouse: 'greenhouse', lever: 'lever', ashby: 'ashby',
  smartrecruiters: 'smartrecruiters', 'oracle hcm': 'oracle_hcm', eightfold: 'eightfold', custom: 'custom',
};

const file = process.argv[2] ?? 'companies.csv';
const rows: Record<string, string>[] = parse(readFileSync(file, 'utf8'), { columns: true, trim: true });
const db = openDb();

const upsert = db.prepare(`
  INSERT INTO companies (name, priority, sector, hubs, path_fit, career_url, ats)
  VALUES (@name, @priority, @sector, @hubs, @pathFit, @careerUrl, @ats)
  ON CONFLICT(name) DO UPDATE SET
    priority = excluded.priority, sector = excluded.sector, hubs = excluded.hubs,
    path_fit = excluded.path_fit, career_url = excluded.career_url,
    ats = CASE WHEN companies.ats_verified = 1 THEN companies.ats ELSE excluded.ats END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
`);

const seed = db.transaction((items: Record<string, string>[]) => {
  for (const r of items) {
    upsert.run({
      name: r.company,
      priority: r.priority,
      sector: r.sector || null,
      hubs: r.hubs || null,
      pathFit: r.path_fit || null,
      careerUrl: r.career_url || null,
      ats: ATS_MAP[(r.likely_ats ?? '').toLowerCase()] ?? 'unknown',
    });
  }
});
seed(rows);

const count = db.prepare('SELECT COUNT(*) AS n FROM companies').get() as { n: number };
console.log(`Seeded ${rows.length} rows. Companies in database: ${count.n}`);
