import type Database from 'better-sqlite3';
import { parse } from 'csv-parse/sync';
import { descriptionHash } from './hash.js';
import type { Ats, FetchedJob } from './types.js';

const ATS_MAP: Record<string, Ats> = {
  workday: 'workday', greenhouse: 'greenhouse', lever: 'lever', ashby: 'ashby',
  smartrecruiters: 'smartrecruiters', 'oracle hcm': 'oracle_hcm', eightfold: 'eightfold', custom: 'custom',
};

/**
 * Loads companies.csv. Safe to rerun.
 * The CSV is the source of truth for platform IDs: when a row has an `ats` value, its ats, ats_id,
 * workday_host, workday_site and ats_verified are written to the DB. When `ats` is empty, an existing
 * DB value is kept if it is verified or was detected (has IDs); otherwise `likely_ats` is used.
 */
export function seedCompanies(db: Database.Database, csvText: string): number {
  const rows: Record<string, string>[] = parse(csvText, { columns: true, trim: true });
  const upsert = db.prepare(`
    INSERT INTO companies (name, priority, sector, hubs, path_fit, career_url,
                           ats, ats_id, workday_host, workday_site, ats_verified)
    VALUES (@name, @priority, @sector, @hubs, @pathFit, @careerUrl,
            @ats, @atsId, @workdayHost, @workdaySite, @atsVerified)
    ON CONFLICT(name) DO UPDATE SET
      priority = excluded.priority, sector = excluded.sector, hubs = excluded.hubs,
      path_fit = excluded.path_fit, career_url = excluded.career_url,
      ats = CASE WHEN @fromCsv = 1 THEN excluded.ats
                 WHEN companies.ats_verified = 1 OR companies.ats_id IS NOT NULL
                      OR companies.workday_host IS NOT NULL THEN companies.ats
                 ELSE excluded.ats END,
      ats_id = CASE WHEN @fromCsv = 1 THEN excluded.ats_id ELSE companies.ats_id END,
      workday_host = CASE WHEN @fromCsv = 1 THEN excluded.workday_host ELSE companies.workday_host END,
      workday_site = CASE WHEN @fromCsv = 1 THEN excluded.workday_site ELSE companies.workday_site END,
      ats_verified = CASE WHEN @fromCsv = 1 THEN excluded.ats_verified ELSE companies.ats_verified END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
  `);
  db.transaction(() => {
    for (const r of rows) {
      const csvAts = (r.ats ?? '').trim().toLowerCase();
      const fromCsv = csvAts !== '';
      upsert.run({
        name: r.company, priority: r.priority, sector: r.sector || null, hubs: r.hubs || null,
        pathFit: r.path_fit || null, careerUrl: r.career_url || null,
        ats: fromCsv ? (csvAts as Ats) : ATS_MAP[(r.likely_ats ?? '').toLowerCase()] ?? 'unknown',
        atsId: r.ats_id || null, workdayHost: r.workday_host || null, workdaySite: r.workday_site || null,
        atsVerified: r.ats_verified === '1' ? 1 : 0, fromCsv: fromCsv ? 1 : 0,
      });
    }
  })();
  return rows.length;
}

export const COMPANY_CSV_COLUMNS = [
  'company', 'priority', 'sector', 'hubs', 'path_fit', 'career_url', 'likely_ats', 'ats_confidence',
  'ats', 'ats_id', 'workday_host', 'workday_site', 'ats_verified',
] as const;

/**
 * Writes the companies table back to CSV text, keeping likely_ats / ats_confidence from the original CSV.
 * Run after detection or manual fixes so platform IDs are committed to git.
 */
export function exportCompanies(db: Database.Database, originalCsv: string): string {
  const original: Record<string, string>[] = parse(originalCsv, { columns: true, trim: true });
  const byName = new Map(original.map((r) => [r.company, r]));
  const rows = db.prepare(`SELECT name, priority, sector, hubs, path_fit, career_url, ats, ats_id,
                                  workday_host, workday_site, ats_verified FROM companies ORDER BY id`).all() as any[];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [COMPANY_CSV_COLUMNS.join(',')];
  for (const r of rows) {
    const o = byName.get(r.name) ?? {};
    const known = r.ats !== 'unknown' && (r.ats_id || r.workday_host || r.ats_verified || ['oracle_hcm', 'eightfold', 'custom'].includes(r.ats));
    lines.push([
      r.name, r.priority, r.sector, r.hubs, r.path_fit, r.career_url, o.likely_ats ?? '', o.ats_confidence ?? '',
      known ? r.ats : '', r.ats_id, r.workday_host, r.workday_site, r.ats_verified ? 1 : '',
    ].map(esc).join(','));
  }
  return lines.join('\n') + '\n';
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
