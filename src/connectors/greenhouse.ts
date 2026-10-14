// Greenhouse public job board: one call returns every job with its description.
// Also hosts small helpers the other Phase 1A connectors share.

import type { Company, Connector, FetchedJob } from '../db/types.js';
import { politeJson } from './http.js';

/** How connectors fetch JSON. Production uses politeJson; tests pass a fake. */
export type FetchJson = (url: string) => Promise<unknown>;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', bull: '•',
};

/** Decodes HTML entities (&amp;, &#39;, &#x2019; ...). Unknown names are left as is. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Turns an HTML fragment into readable plain text. Returns null when nothing is left. */
export function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|ul|ol|h[1-6]|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  const cleaned = decodeEntities(text)
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^-\s*$/gm, '')
    .trim();
  return cleaned || null;
}

/** Any date the APIs give (ISO with offset, epoch ms) as `YYYY-MM-DDTHH:MM:SSZ`, or null. */
export function toIsoUtc(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function mentionsRemote(text: string | null | undefined): boolean {
  return !!text && /\bremote\b/i.test(text);
}

/** The board slug for this company, or a clear error when it hasn't been filled in. */
export function requireAtsId(company: Company): string {
  if (!company.atsId) throw new Error(`${company.name}: atsId is not set`);
  return company.atsId;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>) : {};
}

export function str(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

// ---- Greenhouse ----

export function greenhouseUrl(boardToken: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;
}

/** Maps one job from the board API. `content` is HTML that Greenhouse sends entity-escaped. */
export function mapGreenhouseJob(raw: unknown): FetchedJob | null {
  const j = asRecord(raw);
  const id = str(j.id);
  const title = str(j.title);
  const url = str(j.absolute_url);
  if (!id || !title || !url) return null;
  const location = str(asRecord(j.location).name);
  const content = str(j.content);
  return {
    externalId: id,
    title,
    location,
    isRemote: mentionsRemote(location),
    url,
    postedAt: toIsoUtc(str(j.first_published) ?? str(j.updated_at)),
    description: stripHtml(content === null ? null : decodeEntities(content)),
    raw,
  };
}

export function createGreenhouseConnector(fetchJson: FetchJson = politeJson): Connector {
  return {
    ats: 'greenhouse',
    async fetchJobs(company) {
      const data = asRecord(await fetchJson(greenhouseUrl(requireAtsId(company))));
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      return jobs.map(mapGreenhouseJob).filter((j): j is FetchedJob => j !== null);
    },
  };
}

export const greenhouse = createGreenhouseConnector();
