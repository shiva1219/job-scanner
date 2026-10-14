// SmartRecruiters public postings API. The list is paginated and has no descriptions,
// so each job's description needs its own call; we do that for the newest MAX_DETAILS only.

import type { Connector, FetchedJob } from '../db/types.js';
import { HttpError, politeJson } from './http.js';
import {
  type FetchJson, asRecord, mentionsRemote, requireAtsId, str, stripHtml, toIsoUtc,
} from './greenhouse.js';

const API = 'https://api.smartrecruiters.com/v1/companies';
const PAGE_SIZE = 100;
const MAX_PAGES = 50;                 // 5,000 jobs: a guard against a paging loop
export const MAX_DETAILS = 50;        // detail calls per company per run

export function srListUrl(companyId: string, offset: number): string {
  return `${API}/${encodeURIComponent(companyId)}/postings?limit=${PAGE_SIZE}&offset=${offset}`;
}

export function srDetailUrl(companyId: string, postingId: string): string {
  return `${API}/${encodeURIComponent(companyId)}/postings/${encodeURIComponent(postingId)}`;
}

/** All postings across pages. Note: an unknown company id returns 200 with zero jobs, not 404. */
async function listPostings(fetchJson: FetchJson, companyId: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = asRecord(await fetchJson(srListUrl(companyId, all.length)));
    const content = Array.isArray(data.content) ? data.content.map(asRecord) : [];
    all.push(...content);
    const total = typeof data.totalFound === 'number' ? data.totalFound : 0;
    if (content.length === 0 || all.length >= total) break;
  }
  return all;
}

/** fullLocation can have empty parts ("London, , United Kingdom"); those are dropped. */
function srLocation(loc: Record<string, unknown>): string | null {
  const full = str(loc.fullLocation)?.replace(/,(\s*,)+/g, ',').trim();
  if (full) return full;
  const parts = [str(loc.city), str(loc.region), str(loc.country)?.toUpperCase()].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** Joins the job ad sections (company, job, qualifications, additional info) as plain text. */
export function srDescription(detail: unknown): string | null {
  const sections = asRecord(asRecord(asRecord(detail).jobAd).sections);
  const html = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
    .map((key) => asRecord(sections[key]))
    .filter((s) => str(s.text))
    .map((s) => `<h3>${str(s.title) ?? ''}</h3>${str(s.text)}`)
    .join('\n');
  return stripHtml(html);
}

/** Maps one list posting, plus its detail response when we fetched one. */
export function mapSmartRecruitersJob(posting: unknown, companyId: string, detail?: unknown): FetchedJob | null {
  const p = asRecord(posting);
  const id = str(p.id);
  const title = str(p.name);
  if (!id || !title) return null;
  const d = asRecord(detail);
  const loc = asRecord(p.location);
  const location = srLocation(loc);
  const identifier = str(asRecord(p.company).identifier) ?? companyId;
  return {
    externalId: id,
    title,
    location,
    isRemote: loc.remote === true || mentionsRemote(location),
    url: str(d.postingUrl) ?? `https://jobs.smartrecruiters.com/${encodeURIComponent(identifier)}/${encodeURIComponent(id)}`,
    postedAt: toIsoUtc(str(p.releasedDate)),
    description: detail === undefined ? null : srDescription(detail),
    raw: detail ?? posting,
  };
}

/** Fetches one detail; a blocked host stops the run, any other failure just leaves the description empty. */
async function fetchDetail(fetchJson: FetchJson, companyId: string, postingId: string): Promise<unknown> {
  try {
    return await fetchJson(srDetailUrl(companyId, postingId));
  } catch (e) {
    if (e instanceof HttpError && e.blocked) throw e;
    return undefined;
  }
}

export function createSmartRecruitersConnector(fetchJson: FetchJson = politeJson, maxDetails = MAX_DETAILS): Connector {
  return {
    ats: 'smartrecruiters',
    async fetchJobs(company) {
      const companyId = requireAtsId(company);
      const postings = await listPostings(fetchJson, companyId);
      const newestFirst = [...postings].sort((a, b) => (str(b.releasedDate) ?? '').localeCompare(str(a.releasedDate) ?? ''));
      const jobs: FetchedJob[] = [];
      for (const [i, posting] of newestFirst.entries()) {
        const postingId = str(posting.id);
        const detail = i < maxDetails && postingId ? await fetchDetail(fetchJson, companyId, postingId) : undefined;
        const job = mapSmartRecruitersJob(posting, companyId, detail);
        if (job) jobs.push(job);
      }
      return jobs;
    },
  };
}

export const smartrecruiters = createSmartRecruitersConnector();
