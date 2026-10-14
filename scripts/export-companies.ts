// Writes platform IDs from the database back into companies.csv, so they are committed to git.
// Run after detect-ats or manual fixes. Usage: npm run db:export
import { readFileSync, writeFileSync } from 'node:fs';
import { openDb } from '../src/db/index.js';
import { exportCompanies } from '../src/db/seed.js';

const file = process.argv[2] ?? 'companies.csv';
const db = openDb();
const csv = exportCompanies(db, readFileSync(file, 'utf8'));
writeFileSync(file, csv);
const filled = csv.trim().split('\n').slice(1).filter((l) => l.split(',').length && /,(workday|greenhouse|lever|ashby|smartrecruiters|oracle_hcm|eightfold|custom),/.test(l)).length;
console.log(`Wrote ${file}. Rows with a known platform: ${filled}`);
