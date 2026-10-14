// Lever public postings API: one call returns every posting with its description.

import type { Connector, FetchedJob } from '../db/types.js';
import { politeJson } from './http.js';
import {
  type FetchJson, asRecord, mentionsRemote, requireAtsId, str, stripHtml, toIsoUtc,
} from './greenhouse.js';

export function leverUrl(site: string): string {
  return `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`;
}

/** Lever splits the description into an intro, titled lists, and a closing section. */
function leverDescription(j: Record<string, unknown>): string | null {
  const lists = Array.isArray(j.lists) ? j.lists.map(asRecord) : [];
  const html = [
    str(j.description) ?? '',
    ...lists.map((l) => `<h3>${str(l.text) ?? ''}</h3><ul>${str(l.content) ?? ''}</ul>`),
    str(j.additional) ?? '',
  ].join('\n');
  return stripHtml(html);
}

function leverLocation(categories: Record<string, unknown>): string | null {
  const all = Array.isArray(categories.allLocations)
    ? categories.allLocations.filter((l): l is string => typeof l === 'string') : [];
  return all.length > 0 ? all.join('; ') : str(categories.location);
}

export function mapLeverJob(raw: unknown): FetchedJob | null {
  const j = asRecord(raw);
  const id = str(j.id);
  const title = str(j.text);
  const url = str(j.hostedUrl);
  if (!id || !title || !url) return null;
  const location = leverLocation(asRecord(j.categories));
  return {
    externalId: id,
    title,
    location,
    isRemote: j.workplaceType === 'remote' || mentionsRemote(location),
    url,
    postedAt: toIsoUtc(typeof j.createdAt === 'number' ? j.createdAt : null),
    description: leverDescription(j),
    raw,
  };
}

export function createLeverConnector(fetchJson: FetchJson = politeJson): Connector {
  return {
    ats: 'lever',
    async fetchJobs(company) {
      const data = await fetchJson(leverUrl(requireAtsId(company)));
      const postings = Array.isArray(data) ? data : [];
      return postings.map(mapLeverJob).filter((j): j is FetchedJob => j !== null);
    },
  };
}

export const lever = createLeverConnector();
