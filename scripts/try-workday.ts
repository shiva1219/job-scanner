// Fetches one Workday site live and prints what the connector found. Never writes to the database.
// Usage: npx tsx scripts/try-workday.ts <workday_host> <workday_site> [--details N]
import { createWorkdayConnector } from '../src/connectors/workday.js';
import { HttpError } from '../src/connectors/http.js';
import type { Company } from '../src/db/types.js';

const [host, site] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const detailsArg = process.argv.indexOf('--details');
const maxDetails = detailsArg > 0 ? Number(process.argv[detailsArg + 1]) : 3;
if (!host || !site) {
  console.error('Usage: npx tsx scripts/try-workday.ts <workday_host> <workday_site> [--details N]');
  process.exit(1);
}

const company: Company = {
  id: 0, name: host, priority: 'C', sector: null, hubs: null, pathFit: null, careerUrl: null,
  ats: 'workday', atsId: null, workdayHost: host, workdaySite: site, atsVerified: false, active: true,
};

const started = Date.now();
try {
  const jobs = await createWorkdayConnector({ maxDetails }).fetchJobs(company);
  console.log(`${host} / ${site}: ${jobs.length} jobs in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  for (const j of jobs.slice(0, 3)) {
    console.log(`- ${j.title} | ${j.location ?? '?'} | ${j.postedAt ?? 'date unknown'} | ${j.url}`);
  }
} catch (e) {
  const msg = e instanceof HttpError && e.blocked ? `blocked (HTTP ${e.status}): stop calling this site` : String(e);
  console.error(`${host} / ${site}: failed: ${msg}`);
  process.exit(2);
}
