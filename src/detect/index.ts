import { politeText, HttpError } from '../connectors/http.js';
import { detectFromHtml, jobSearchLinks, type Detection } from './detect.js';

export { detectFromHtml, jobSearchLinks, normalizeHtml, type Detection } from './detect.js';

export type FetchText = (url: string) => Promise<{ text: string; finalUrl: string }>;

export type DetectResult =
  | { status: 'found'; detection: Detection; pageUrl: string }
  | { status: 'not_found'; reason: string };

/**
 * Fetches a careers page and detects its platform. If the page itself shows nothing,
 * follows up to two same-site "search jobs" links one level deep.
 */
export async function detectCareersPage(url: string, fetchText: FetchText = politeText): Promise<DetectResult> {
  let page: { text: string; finalUrl: string };
  try {
    page = await fetchText(url);
  } catch (e) {
    return { status: 'not_found', reason: describeError(e) };
  }
  const direct = detectFromHtml(page.text, page.finalUrl);
  if (direct) return { status: 'found', detection: direct, pageUrl: page.finalUrl };

  for (const link of jobSearchLinks(page.text, page.finalUrl)) {
    try {
      const sub = await fetchText(link);
      const found = detectFromHtml(sub.text, sub.finalUrl);
      if (found) return { status: 'found', detection: found, pageUrl: sub.finalUrl };
    } catch (e) {
      if (e instanceof HttpError && e.blocked) return { status: 'not_found', reason: describeError(e) };
    }
  }
  return { status: 'not_found', reason: 'no platform link in page (may be rendered by JavaScript)' };
}

function describeError(e: unknown): string {
  if (e instanceof HttpError) return e.blocked ? `blocked (HTTP ${e.status})` : `HTTP ${e.status}`;
  if (e instanceof Error) return e.name === 'TimeoutError' ? 'timeout' : e.message;
  return String(e);
}
