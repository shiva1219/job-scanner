// Ashby public job board API: one call returns every listed job with its description.

import type { Connector, FetchedJob } from '../db/types.js';
import { politeJson } from './http.js';
import {
  type FetchJson, asRecord, mentionsRemote, requireAtsId, str, stripHtml, toIsoUtc,
} from './greenhouse.js';

export function ashbyUrl(board: string): string {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}`;
}

function ashbyLocation(j: Record<string, unknown>): string | null {
  const secondary = Array.isArray(j.secondaryLocations)
    ? j.secondaryLocations.map((s) => str(asRecord(s).location)) : [];
  const all = [str(j.location), ...secondary].filter((l): l is string => !!l);
  return all.length > 0 ? all.join('; ') : null;
}

/**
 * Ashby sets isRemote=true on Hybrid jobs too, so workplaceType wins when present.
 * Older boards leave workplaceType null; then fall back to isRemote.
 */
function ashbyIsRemote(j: Record<string, unknown>, location: string | null): boolean {
  if (j.workplaceType === 'Remote') return true;
  if (j.workplaceType == null && j.isRemote === true) return true;
  return mentionsRemote(location);
}

export function mapAshbyJob(raw: unknown): FetchedJob | null {
  const j = asRecord(raw);
  const id = str(j.id);
  const title = str(j.title);
  const url = str(j.jobUrl);
  if (!id || !title || !url || j.isListed === false) return null;
  const location = ashbyLocation(j);
  return {
    externalId: id,
    title,
    location,
    isRemote: ashbyIsRemote(j, location),
    url,
    postedAt: toIsoUtc(str(j.publishedAt)),
    description: stripHtml(str(j.descriptionHtml)) ?? (str(j.descriptionPlain)?.trim() || null),
    raw,
  };
}

export function createAshbyConnector(fetchJson: FetchJson = politeJson): Connector {
  return {
    ats: 'ashby',
    async fetchJobs(company) {
      const data = asRecord(await fetchJson(ashbyUrl(requireAtsId(company))));
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      return jobs.map(mapAshbyJob).filter((j): j is FetchedJob => j !== null);
    },
  };
}

export const ashby = createAshbyConnector();
