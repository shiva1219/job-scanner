// Detects each company's job platform from its careers page and stores it where ats_verified = 0.
// Usage: npx tsx scripts/detect-ats.ts [--dry-run]
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { openDb } from '../src/db/index.js';
import { detectCareersPage, type DetectResult } from '../src/detect/index.js';

interface Row { id: number; name: string; career_url: string; ats_verified: number }

const dryRun = process.argv.includes('--dry-run');
const CONCURRENCY = 8; // different hosts; politeText still spaces calls per host

const db = openDb();
const companies = db.prepare(
  'SELECT id, name, career_url, ats_verified FROM companies WHERE career_url IS NOT NULL ORDER BY name',
).all() as Row[];
const csvAts = likelyAtsByName(readFileSync('companies.csv', 'utf8'));

const results = new Map<number, DetectResult>();
let next = 0;
async function worker(): Promise<void> {
  while (next < companies.length) {
    const c = companies[next++];
    results.set(c.id, await detectCareersPage(c.career_url));
    process.stderr.write('.');
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
process.stderr.write('\n');

const update = db.prepare(`
  UPDATE companies SET ats = @ats, ats_id = @atsId, workday_host = @workdayHost, workday_site = @workdaySite,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
  WHERE id = @id AND ats_verified = 0
`);

const detected: string[] = [];
const different: string[] = [];
const notFound: string[] = [];
let updated = 0;
for (const c of companies) {
  const r = results.get(c.id);
  if (!r || r.status === 'not_found') {
    notFound.push(`${c.name.padEnd(40)} ${c.career_url}  (${r?.reason ?? 'not checked'})`);
    continue;
  }
  const d = r.detection;
  const ids = d.ats === 'workday' ? `${d.workdayHost ?? '?'} / ${d.workdaySite ?? '?'}` : (d.atsId ?? '');
  const locked = c.ats_verified ? '  [verified, not changed]' : '';
  detected.push(`${c.name.padEnd(40)} ${d.ats.padEnd(16)} ${ids}${locked}`);
  const expected = csvAts.get(c.name) ?? 'unknown';
  if (expected !== d.ats) different.push(`${c.name.padEnd(40)} CSV: ${expected.padEnd(16)} found: ${d.ats}  (${d.evidence})`);
  if (!dryRun && !c.ats_verified) updated += update.run({ id: c.id, ...d }).changes;
}

printGroup('Detected', detected);
printGroup("Different from the CSV's likely_ats", different);
printGroup('Not found (check by hand)', notFound);
console.log(`\nChecked ${companies.length}: detected ${detected.length}, different ${different.length}, ` +
  `not found ${notFound.length}. ${dryRun ? 'Dry run: database not changed.' : `Updated ${updated} rows.`}`);

function printGroup(title: string, lines: string[]): void {
  console.log(`\n== ${title} (${lines.length})`);
  for (const l of lines) console.log(`  ${l}`);
}

function likelyAtsByName(csv: string): Map<string, string> {
  const rows: Record<string, string>[] = parse(csv, { columns: true, trim: true });
  return new Map(rows.map((r) => [r.company, (r.likely_ats || 'unknown').toLowerCase().replace(/\s+/g, '_')]));
}
