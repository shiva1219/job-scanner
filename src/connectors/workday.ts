// Workday connector. Uses the public JSON API behind *.myworkdayjobs.com career sites:
//   list:   POST https://{host}/wday/cxs/{tenant}/{site}/jobs   (max 20 per page; `total` is only set on page 1)
//   detail: GET  https://{host}/wday/cxs/{tenant}/{site}{externalPath}
// Verified live on 2026-10-13 against Capital One, Salesforce, Adobe, NVIDIA, Fidelity and Citi.
import { politeJson, HttpError, type PoliteOptions } from './http.js';
import type { Company, Connector, FetchedJob } from '../db/types.js';

// Narrow searches first: the broad "software engineer" search alone can fill the 200-job cap.
export const SEARCHES = ['frontend', 'front end', 'full stack', 'UI engineer', 'web', 'software engineer'];
const PAGE_SIZE = 20;            // Workday rejects larger pages with HTTP 400
const MAX_JOBS = 200;            // per company, across all searches
const MAX_DETAILS = 60;          // detail calls per company
const DAY_MS = 86_400_000;

export type FetchJson = <T = unknown>(url: string, opts?: PoliteOptions) => Promise<T>;

export interface WorkdayOptions {
  fetchJson?: FetchJson;
  now?: () => Date;
  maxJobs?: number;
  maxDetails?: number;
}

/** One row of the list response, narrowed. */
export interface ListPosting {
  title: string;
  externalPath: string;
  locationsText: string | null;
  postedOn: string | null;
  remoteType: string | null;
}

interface Detail {
  title: string | null;
  description: string | null;
  location: string | null;
  startDate: string | null;
  externalUrl: string | null;
  remoteType: string | null;
}

export function createWorkdayConnector(opts: WorkdayOptions = {}): Connector {
  const fetchJson = opts.fetchJson ?? politeJson;
  const now = opts.now ?? (() => new Date());
  const maxJobs = opts.maxJobs ?? MAX_JOBS;
  const maxDetails = opts.maxDetails ?? MAX_DETAILS;

  return {
    ats: 'workday',
    async fetchJobs(company: Company): Promise<FetchedJob[]> {
      const { host, site } = workdayTarget(company);
      const base = `https://${host}/wday/cxs/${tenantOf(host)}/${site}`;
      const postings = await listAll(fetchJson, base, maxJobs);
      const today = now();
      const ranked = [...postings].sort((a, b) => relevance(b.title) - relevance(a.title));
      const withDetail = new Set(ranked.slice(0, maxDetails).map((p) => p.externalPath));

      const jobs: FetchedJob[] = [];
      for (const p of postings) {
        const detail = withDetail.has(p.externalPath) ? await fetchDetail(fetchJson, base, p.externalPath) : null;
        jobs.push(toFetchedJob(p, detail, host, site, today));
      }
      return jobs;
    },
  };
}

export const workdayConnector: Connector = createWorkdayConnector();

function workdayTarget(company: Company): { host: string; site: string } {
  if (!company.workdayHost || !company.workdaySite) {
    throw new Error(`${company.name}: workday_host and workday_site must be set`);
  }
  return { host: company.workdayHost, site: company.workdaySite };
}

/** "capitalone.wd12.myworkdayjobs.com" -> "capitalone" */
export function tenantOf(host: string): string {
  return host.split('.')[0];
}

/** Runs every search, pages through each, and deduplicates by externalPath. Stops at maxJobs. */
export async function listAll(fetchJson: FetchJson, base: string, maxJobs: number): Promise<ListPosting[]> {
  const seen = new Map<string, ListPosting>();
  for (const searchText of SEARCHES) {
    let total = Infinity;
    for (let offset = 0; offset < total && seen.size < maxJobs; offset += PAGE_SIZE) {
      const body = { appliedFacets: {}, limit: PAGE_SIZE, offset, searchText };
      const page = parseListPage(await fetchJson(`${base}/jobs`, { method: 'POST', body }));
      if (offset === 0) total = page.total;
      for (const p of page.postings) {
        if (seen.size >= maxJobs) break;
        if (!seen.has(p.externalPath)) seen.set(p.externalPath, p);
      }
      if (page.postings.length < PAGE_SIZE) break;
    }
    if (seen.size >= maxJobs) break;
  }
  return [...seen.values()];
}

export function parseListPage(raw: unknown): { total: number; postings: ListPosting[] } {
  const obj = asRecord(raw);
  const list = Array.isArray(obj.jobPostings) ? obj.jobPostings : [];
  const postings: ListPosting[] = [];
  for (const item of list) {
    const r = asRecord(item);
    const title = str(r.title);
    const externalPath = str(r.externalPath);
    if (!title || !externalPath) continue;
    postings.push({
      title, externalPath,
      locationsText: str(r.locationsText), postedOn: str(r.postedOn), remoteType: str(r.remoteType),
    });
  }
  return { total: typeof obj.total === 'number' ? obj.total : 0, postings };
}

/** Fetches one job's detail. A blocked site stops the company; any other error just skips the detail. */
async function fetchDetail(fetchJson: FetchJson, base: string, externalPath: string): Promise<Detail | null> {
  try {
    return parseDetail(await fetchJson(`${base}${externalPath}`));
  } catch (e) {
    if (e instanceof HttpError && e.blocked) throw e;
    return null;
  }
}

export function parseDetail(raw: unknown): Detail | null {
  const info = asRecord(asRecord(raw).jobPostingInfo);
  if (!Object.keys(info).length) return null;
  const extra = Array.isArray(info.additionalLocations) ? info.additionalLocations.map(str).filter(Boolean) : [];
  const main = str(info.location);
  const locations = [main, ...extra].filter((l): l is string => !!l);
  const html = str(info.jobDescription);
  return {
    title: str(info.title),
    description: html ? htmlToText(html) : null,
    location: locations.length ? locations.join('; ') : null,
    startDate: str(info.startDate),
    externalUrl: str(info.externalUrl),
    remoteType: str(info.remoteType),
  };
}

export function toFetchedJob(p: ListPosting, d: Detail | null, host: string, site: string, today: Date): FetchedJob {
  const location = d?.location ?? p.locationsText;
  const remoteText = [location, d?.remoteType ?? p.remoteType, p.title].filter(Boolean).join(' ');
  return {
    externalId: p.externalPath,
    title: d?.title ?? p.title,
    location,
    isRemote: /\bremote\b/i.test(remoteText),
    url: d?.externalUrl ?? `https://${host}/${site}${p.externalPath}`,
    postedAt: isoDate(d?.startDate) ?? parsePostedOn(p.postedOn, today),
    description: d?.description ?? null,
    raw: { list: p, detail: d },
  };
}

/**
 * "Posted Today" / "Posted Yesterday" / "Posted 3 Days Ago" -> approximate ISO date (midnight UTC).
 * "Posted 30+ Days Ago" and anything unrecognised -> null.
 */
export function parsePostedOn(text: string | null, today: Date): string | null {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  let days: number | null = null;
  if (/\btoday\b/.test(t)) days = 0;
  else if (/\byesterday\b/.test(t)) days = 1;
  else {
    const m = /(\d+)\s*days?\s+ago/.exec(t);
    if (m && !/\+/.test(t)) days = Number(m[1]);
  }
  if (days === null) return null;
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - days * DAY_MS);
  return d.toISOString().replace('.000Z', 'Z');
}

function isoDate(s: string | null | undefined): string | null {
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : null;
}

/** Puts frontend-looking titles first so they get the limited detail calls. */
function relevance(title: string): number {
  return /front|full[\s-]?stack|\bweb\b|\bui\b|react|angular|javascript|typescript/i.test(title) ? 1 : 0;
}

/** Workday descriptions are HTML; the rest of the pipeline wants plain text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/ul|\/ol)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
