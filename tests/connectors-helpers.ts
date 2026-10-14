import type { Ats, Company } from '../src/db/types.js';

/** A minimal company row for connector tests. */
export function company(ats: Ats, atsId: string | null): Company {
  return {
    id: 1, name: 'TestCo', priority: 'A', sector: null, hubs: null, pathFit: null, careerUrl: null,
    ats, atsId, workdayHost: null, workdaySite: null, atsVerified: true, active: true,
  };
}
