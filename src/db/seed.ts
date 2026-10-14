import type Database from 'better-sqlite3';
import { parse } from 'csv-parse/sync';
import { descriptionHash } from './hash.js';
import type { Ats, FetchedJob } from './types.js';

const ATS_MAP: Record<string, Ats> = {
  workday: 'workday', greenhouse: 'greenhouse', lever: 'lever', ashby: 'ashby',
  smartrecruiters: 'smartrecruiters', 'oracle hcm': 'oracle_hcm', eightfold: 'eightfold', custom: 'custom',
};

/** Loads companies.csv text. Safe to rerun; keeps a platform you've marked verified. */
export function seedCompanies(db: Database.Database, csvText: string): number {
  const rows: Record<string, string>[] = parse(csvText, { columns: true, trim: true });
  const upsert = db.prepare(`
    INSERT INTO companies (name, priority, sector, hubs, path_fit, career_url, ats)
    VALUES (@name, @priority, @sector, @hubs, @pathFit, @careerUrl, @ats)
    ON CONFLICT(name) DO UPDATE SET
      priority = excluded.priority, sector = excluded.sector, hubs = excluded.hubs,
      path_fit = excluded.path_fit, career_url = excluded.career_url,
      ats = CASE WHEN companies.ats_verified = 1 THEN companies.ats ELSE excluded.ats END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
  `);
  db.transaction(() => {
    for (const r of rows) {
      upsert.run({
        name: r.company, priority: r.priority, sector: r.sector || null, hubs: r.hubs || null,
        pathFit: r.path_fit || null, careerUrl: r.career_url || null,
        ats: ATS_MAP[(r.likely_ats ?? '').toLowerCase()] ?? 'unknown',
      });
    }
  })();
  return rows.length;
}

export interface FixtureJob extends FetchedJob {
  company: string;
  expected: { filterPass: boolean; sponsorshipFlag: boolean; verdict: string; note: string };
}

/**
 * Saves fetched jobs for one company: inserts new ones, refreshes last_seen_at on existing ones.
 * Connectors in Phase 1 reuse this. Returns the number of new jobs.
 */
export function saveJobs(db: Database.Database, companyId: number, jobs: FetchedJob[]): number {
  const insert = db.prepare(`
    INSERT INTO jobs (company_id, external_id, title, location, is_remote, url, posted_at,
                      description, description_hash, raw_json)
    VALUES (@companyId, @externalId, @title, @location, @isRemote, @url, @postedAt,
            @description, @hash, @raw)
    ON CONFLICT(company_id, external_id) DO UPDATE SET
      title = excluded.title, location = excluded.location, is_remote = excluded.is_remote,
      url = excluded.url, description = excluded.description,
      description_hash = excluded.description_hash, raw_json = excluded.raw_json,
      last_seen_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), closed_at = NULL
  `);
  const exists = db.prepare('SELECT 1 FROM jobs WHERE company_id = ? AND external_id = ?');
  let added = 0;
  db.transaction(() => {
    for (const j of jobs) {
      if (!exists.get(companyId, j.externalId)) added++;
      insert.run({
        companyId, externalId: j.externalId, title: j.title, location: j.location,
        isRemote: j.isRemote ? 1 : 0, url: j.url, postedAt: j.postedAt, description: j.description,
        hash: descriptionHash(j.description), raw: j.raw === undefined ? null : JSON.stringify(j.raw),
      });
    }
  })();
  return added;
}

/** Loads sample jobs (fixtures/jobs.json) using saveJobs. Companies must be seeded first. */
export function loadFixtures(db: Database.Database, fixtures: FixtureJob[]): number {
  const findCompany = db.prepare('SELECT id FROM companies WHERE name = ?');
  let added = 0;
  for (const f of fixtures) {
    const row = findCompany.get(f.company) as { id: number } | undefined;
    if (!row) throw new Error(`Fixture company not found in companies table: ${f.company}`);
    const { company, expected, ...job } = f;
    added += saveJobs(db, row.id, [job]);
  }
  return added;
}
