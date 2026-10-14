// Loads companies.csv into the companies table. Safe to rerun.
// Usage: npm run db:seed [-- path/to/companies.csv]
import { readFileSync } from 'node:fs';
import { openDb } from '../src/db/index.js';
import { seedCompanies } from '../src/db/seed.js';

const file = process.argv[2] ?? 'companies.csv';
const db = openDb();
const n = seedCompanies(db, readFileSync(file, 'utf8'));
const { count } = db.prepare('SELECT COUNT(*) AS count FROM companies').get() as { count: number };
console.log(`Seeded ${n} rows. Companies in database: ${count}`);
