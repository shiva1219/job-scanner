import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectFromHtml, jobSearchLinks, detectCareersPage, type FetchText } from '../src/detect/index.js';
import { HttpError } from '../src/connectors/http.js';

const sample = (name: string) => readFileSync(`tests/samples/detect/${name}.html`, 'utf8');

// Real pages, trimmed (tests/samples/detect/). Final URLs are what politeText reported.
const REAL: { file: string; finalUrl: string; expect: Partial<ReturnType<typeof detectFromHtml> & object> }[] = [
  { file: 'capitalone', finalUrl: 'https://www.capitalonecareers.com/',
    expect: { ats: 'workday', workdayHost: 'capitalone.wd12.myworkdayjobs.com', workdaySite: 'Capital_One' } },
  { file: 'citi', finalUrl: 'https://jobs.citi.com/',
    expect: { ats: 'workday', workdayHost: 'citi.wd5.myworkdayjobs.com', workdaySite: '2' } },
  { file: 'bankofamerica', finalUrl: 'https://careers.bankofamerica.com/en-us',
    expect: { ats: 'workday', workdayHost: 'ghr.wd1.myworkdayjobs.com', workdaySite: 'lateral-us' } },
  { file: 'nvidia', finalUrl: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite',
    expect: { ats: 'workday', workdayHost: 'nvidia.wd5.myworkdayjobs.com', workdaySite: 'NVIDIAExternalCareerSite' } },
  { file: 'figma', finalUrl: 'https://www.figma.com/careers/', expect: { ats: 'greenhouse', atsId: 'figma' } },
  { file: 'reddit', finalUrl: 'https://redditinc.com/careers', expect: { ats: 'greenhouse', atsId: 'reddit' } },
  { file: 'robinhood', finalUrl: 'https://careers.robinhood.com/', expect: { ats: 'greenhouse', atsId: 'robinhood' } },
  { file: 'matchgroup', finalUrl: 'https://mtch.com/careers/', expect: { ats: 'lever', atsId: 'matchgroup' } },
  { file: 'notion', finalUrl: 'https://www.notion.com/careers', expect: { ats: 'ashby', atsId: 'notion' } },
  { file: 'jpmorgan', finalUrl: 'https://www.jpmorganchase.com/careers?redirect=careers_jpm', expect: { ats: 'oracle_hcm', atsId: null } },
  { file: 'qualcomm', finalUrl: 'https://careers.qualcomm.com/careers', expect: { ats: 'eightfold', atsId: null } },
];

for (const s of REAL) {
  test(`detects ${s.expect.ats} on the ${s.file} sample`, () => {
    const d = detectFromHtml(sample(s.file), s.finalUrl);
    assert.ok(d, 'expected a detection');
    for (const [k, v] of Object.entries(s.expect)) assert.equal(d[k as keyof typeof d], v, k);
  });
}

test('returns null for a page with no platform links (sabre sample)', () => {
  assert.equal(detectFromHtml(sample('sabre'), 'https://www.sabre.com/careers'), null);
});

test('returns null for empty HTML', () => {
  assert.equal(detectFromHtml('', 'https://example.com/careers'), null);
});

test('prefers Workday over an Eightfold talent-network link (capitalone sample)', () => {
  const html = sample('capitalone');
  assert.match(html, /eightfold\.ai/);
  assert.equal(detectFromHtml(html, 'https://www.capitalonecareers.com/')?.ats, 'workday');
});

test('a redirect to a platform wins over links on the page', () => {
  const html = '<a href="https://jobs.lever.co/other">x</a>';
  const d = detectFromHtml(html, 'https://jobs.ashbyhq.com/acme');
  assert.deepEqual([d?.ats, d?.atsId], ['ashby', 'acme']);
});

test('Oracle Candidate Experience on a company domain (Dell redirect)', () => {
  const d = detectFromHtml('', 'https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers');
  assert.equal(d?.ats, 'oracle_hcm');
});

// Small hand-written snippets for patterns no target company showed on 2026-10-13.
test('Greenhouse embed script', () => {
  const html = '<script src="https://boards.greenhouse.io/embed/job_board/js?for=acmeco"></script>';
  const d = detectFromHtml(html, 'https://acme.example/careers');
  assert.deepEqual([d?.ats, d?.atsId], ['greenhouse', 'acmeco']);
});

test('SmartRecruiters jobs and careers hosts', () => {
  for (const host of ['jobs', 'careers']) {
    const d = detectFromHtml(`<a href="https://${host}.smartrecruiters.com/AcmeCorp1">Jobs</a>`, 'https://acme.example/');
    assert.deepEqual([d?.ats, d?.atsId], ['smartrecruiters', 'AcmeCorp1']);
  }
});

test('finds URLs hidden in escaped JSON', () => {
  const html = '<script>{"url":"https:\\/\\/jobs.lever.co\\/acme\\/123"}</script>';
  const d = detectFromHtml(html, 'https://acme.example/');
  assert.deepEqual([d?.ats, d?.atsId], ['lever', 'acme']);
});

test('Workday link with only a host still detects workday, site null', () => {
  const d = detectFromHtml('<a href="https://acme.wd1.myworkdayjobs.com">x</a>', 'https://acme.example/');
  assert.deepEqual([d?.ats, d?.workdayHost, d?.workdaySite], ['workday', 'acme.wd1.myworkdayjobs.com', null]);
});

test('jobSearchLinks keeps same-site job links only', () => {
  const html = `
    <a href="/jobs">Search jobs</a>
    <a href="https://other.example/jobs">Partner jobs</a>
    <a href="/about">About us</a>`;
  assert.deepEqual(jobSearchLinks(html, 'https://careers.acme.example/'), ['https://careers.acme.example/jobs']);
});

function fakeFetch(pages: Record<string, string | Error>): FetchText {
  return async (url) => {
    const p = pages[url];
    if (p === undefined) throw new HttpError(404, url);
    if (p instanceof Error) throw p;
    return { text: p, finalUrl: url };
  };
}

test('detectCareersPage follows a "search jobs" link one level deep', async () => {
  const r = await detectCareersPage('https://acme.example/careers', fakeFetch({
    'https://acme.example/careers': '<a href="/jobs">See all jobs</a>',
    'https://acme.example/jobs': '<a href="https://acme.wd5.myworkdayjobs.com/en-US/External/job/x">Apply</a>',
  }));
  assert.equal(r.status, 'found');
  if (r.status === 'found') assert.equal(r.detection.workdaySite, 'External');
});

test('detectCareersPage reports a blocked site as not found', async () => {
  const url = 'https://acme.example/careers';
  const r = await detectCareersPage(url, fakeFetch({ [url]: new HttpError(403, url) }));
  assert.deepEqual(r, { status: 'not_found', reason: 'blocked (HTTP 403)' });
});
