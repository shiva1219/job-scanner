// Live smoke test for one Phase 1A board. Never touches the database.
// Usage: npx tsx scripts/try-1a.ts <greenhouse|lever|ashby|smartrecruiters> <atsId>

import type { Company, Connector } from '../src/db/types.js';
import { greenhouse } from '../src/connectors/greenhouse.js';
import { lever } from '../src/connectors/lever.js';
import { ashby } from '../src/connectors/ashby.js';
import { smartrecruiters } from '../src/connectors/smartrecruiters.js';
import { HttpError } from '../src/connectors/http.js';

const CONNECTORS: Record<string, Connector> = { greenhouse, lever, ashby, smartrecruiters };

async function main(): Promise<void> {
  const [platform, atsId] = process.argv.slice(2);
  const connector = platform ? CONNECTORS[platform] : undefined;
  if (!connector || !atsId) {
    console.error(`Usage: npx tsx scripts/try-1a.ts <${Object.keys(CONNECTORS).join('|')}> <atsId>`);
    process.exit(2);
  }
  const company: Company = {
    id: 0, name: atsId, priority: 'C', sector: null, hubs: null, pathFit: null, careerUrl: null,
    ats: connector.ats, atsId, workdayHost: null, workdaySite: null, atsVerified: false, active: true,
  };
  const started = Date.now();
  const jobs = await connector.fetchJobs(company);
  console.log(`${platform}/${atsId}: ${jobs.length} jobs in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  for (const j of jobs.slice(0, 3)) console.log(`- ${j.title} | ${j.location ?? '?'} | ${j.url}`);
}

main().catch((e: unknown) => {
  if (e instanceof HttpError) console.error(`${e.message}${e.blocked ? ' (blocked: stop calling this site)' : ''}`);
  else console.error(e);
  process.exit(1);
});
