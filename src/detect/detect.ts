// Finds which job platform a careers page uses, from links, redirects and embeds in its HTML.
// Pure functions: no network. scripts/detect-ats.ts does the fetching.
import type { Ats } from '../db/types.js';

export interface Detection {
  ats: Ats;
  atsId: string | null;
  workdayHost: string | null;
  workdaySite: string | null;
  /** The URL fragment that matched, for the report. */
  evidence: string;
}

interface Rule {
  ats: Ats;
  pattern: RegExp;
  toDetection(m: RegExpExecArray): Detection | null;
}

// Path segments that are never a board token / slug.
const NOT_AN_ID = new Set(['embed', 'js', 'api', 'static', 'assets', 'v0', 'v1', 'posting-api', 'job_board']);
// Workday path segments that are not a site name.
const NOT_A_SITE = new Set(['wday', 'job', 'jobs', 'details', 'login', 'apply']);
const LOCALE = /^[a-z]{2}-[a-z]{2}$/i;

function slug(ats: Ats, id: string, evidence: string): Detection | null {
  if (NOT_AN_ID.has(id.toLowerCase())) return null;
  return { ats, atsId: id, workdayHost: null, workdaySite: null, evidence };
}

function platformOnly(ats: Ats, evidence: string): Detection {
  return { ats, atsId: null, workdayHost: null, workdaySite: null, evidence };
}

function workday(m: RegExpExecArray): Detection {
  const host = m[1].toLowerCase();
  const segments = (m[2] ?? '').split('/').filter(Boolean);
  if (segments[0] && LOCALE.test(segments[0])) segments.shift();
  const site = segments[0] && !NOT_A_SITE.has(segments[0].toLowerCase()) ? segments[0] : null;
  return { ats: 'workday', atsId: null, workdayHost: host, workdaySite: site, evidence: m[0] };
}

const ID = '([A-Za-z0-9][A-Za-z0-9_.-]*)';

// Platforms we have a connector for. Pages often link Eightfold or Oracle for a talent
// network or events sign-up while the real job list lives on one of these.
const PREFERRED = new Set<Ats>(['workday', 'greenhouse', 'lever', 'ashby', 'smartrecruiters']);

// Order matters only for ties: the rule with the most matches wins.
const RULES: Rule[] = [
  {
    ats: 'workday',
    pattern: /([a-z0-9-]+\.wd\d+\.myworkdayjobs\.com)((?:\/[A-Za-z0-9_-]+){0,2})/gi,
    toDetection: workday,
  },
  {
    ats: 'greenhouse',
    pattern: new RegExp(`(?:boards|job-boards)(?:\\.eu)?\\.greenhouse\\.io/${ID}`, 'gi'),
    toDetection: (m) => slug('greenhouse', m[1], m[0]),
  },
  {
    ats: 'greenhouse',
    pattern: new RegExp(`greenhouse\\.io/(?:embed/job_board(?:/js)?\\?for=|v1/boards/)${ID}`, 'gi'),
    toDetection: (m) => slug('greenhouse', m[1], m[0]),
  },
  {
    ats: 'lever',
    pattern: new RegExp(`(?:jobs\\.lever\\.co|api\\.lever\\.co/v0/postings)/${ID}`, 'gi'),
    toDetection: (m) => slug('lever', m[1], m[0]),
  },
  {
    ats: 'ashby',
    pattern: new RegExp(`(?:jobs\\.ashbyhq\\.com|api\\.ashbyhq\\.com/posting-api/job-board)/${ID}`, 'gi'),
    toDetection: (m) => slug('ashby', m[1], m[0]),
  },
  {
    ats: 'smartrecruiters',
    pattern: new RegExp(`(?:jobs|careers)\\.smartrecruiters\\.com/${ID}`, 'gi'),
    toDetection: (m) => slug('smartrecruiters', m[1], m[0]),
  },
  {
    ats: 'oracle_hcm',
    pattern: /[a-z0-9-]+(?:\.[a-z0-9-]+)*\.oraclecloud\.com/gi,
    toDetection: (m) => platformOnly('oracle_hcm', m[0]),
  },
  {
    // Oracle Candidate Experience on a company's own domain, e.g. careers.example.com/hcmUI/CandidateExperience
    ats: 'oracle_hcm',
    pattern: /[a-z0-9.-]+\/hcmUI\/CandidateExperience/gi,
    toDetection: (m) => platformOnly('oracle_hcm', m[0]),
  },
  {
    ats: 'eightfold',
    pattern: /[a-z0-9-]+\.eightfold\.ai/gi,
    toDetection: (m) => platformOnly('eightfold', m[0]),
  },
];

/** Undoes the escaping that hides URLs inside JSON blobs and attributes. */
export function normalizeHtml(html: string): string {
  return html
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\\//g, '/')
    .replace(/&#x2[fF];|&#47;/g, '/')
    .replace(/&amp;/g, '&');
}

function allMatches(text: string): Detection[] {
  const found: Detection[] = [];
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (let m = rule.pattern.exec(text); m; m = rule.pattern.exec(text)) {
      const d = rule.toDetection(m);
      if (d) found.push(d);
    }
  }
  return found;
}

/** For Workday, a match that names a site beats one that only names the host. */
function bestOf(matches: Detection[]): Detection {
  return matches.find((d) => d.ats !== 'workday' || d.workdaySite) ?? matches[0];
}

/**
 * Detects the job platform from a careers page. A redirect to a platform wins;
 * otherwise the platform linked most often on the page, preferring ones we have a connector for.
 * Returns null if none is found.
 */
export function detectFromHtml(html: string, finalUrl: string): Detection | null {
  const fromUrl = allMatches(finalUrl);
  if (fromUrl.length) return bestOf(fromUrl);

  const all = allMatches(normalizeHtml(html));
  const preferred = all.filter((d) => PREFERRED.has(d.ats));
  const matches = preferred.length ? preferred : all;
  if (!matches.length) return null;
  const counts = new Map<Ats, number>();
  for (const d of matches) counts.set(d.ats, (counts.get(d.ats) ?? 0) + 1);
  let winner = matches[0].ats;
  for (const [ats, n] of counts) if (n > (counts.get(winner) ?? 0)) winner = ats;
  return bestOf(matches.filter((d) => d.ats === winner));
}

const JOB_LINK = /\b(search|find|view|browse|explore|see)?\s*(all\s+)?(jobs|openings|positions|opportunities|careers)\b/i;

/**
 * Same-site links on a careers page that probably lead to the job search
 * (e.g. "Search jobs"), so the detector can look one page deeper. At most `limit`.
 */
export function jobSearchLinks(html: string, finalUrl: string, limit = 2): string[] {
  const base = new URL(finalUrl);
  const out: string[] = [];
  const anchor = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = anchor.exec(html); m && out.length < limit; m = anchor.exec(html)) {
    const text = m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const href = m[1];
    if (!JOB_LINK.test(text) && !/\/(jobs|search|job-search|openings)\b/i.test(href)) continue;
    let url: URL;
    try { url = new URL(href, base); } catch { continue; }
    if (!/^https?:$/.test(url.protocol) || url.href === base.href) continue;
    if (!sameSite(url.hostname, base.hostname)) continue;
    if (!out.includes(url.href)) out.push(url.href);
  }
  return out;
}

function sameSite(a: string, b: string): boolean {
  const root = (h: string) => h.split('.').slice(-2).join('.');
  return root(a) === root(b);
}
