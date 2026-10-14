// Shared types. Every phase builds on these: agents must not change them without asking.

export type Priority = 'A' | 'B' | 'C';
export type Ats =
  | 'workday' | 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters'
  | 'oracle_hcm' | 'eightfold' | 'custom' | 'unknown';
export type Verdict = 'APPLY' | 'APPLY_WITH_REFERRAL' | 'SKIP' | 'NEEDS_REVIEW';
export type AppStatus = 'new' | 'watching' | 'applied' | 'interviewing' | 'offer' | 'rejected' | 'skipped';
export type ScorerKind = 'claude-code' | 'api';

export interface Company {
  id: number;
  name: string;
  priority: Priority;
  sector: string | null;
  hubs: string | null;
  pathFit: string | null;
  careerUrl: string | null;
  ats: Ats;
  atsId: string | null;
  workdayHost: string | null;
  workdaySite: string | null;
  atsVerified: boolean;
  active: boolean;
}

/** What every connector returns, before it is saved. */
export interface FetchedJob {
  externalId: string;
  title: string;
  location: string | null;
  isRemote: boolean;
  url: string;
  postedAt: string | null;
  description: string | null;
  raw?: unknown;
}

export interface Job extends FetchedJob {
  id: number;
  companyId: number;
  firstSeenAt: string;
  lastSeenAt: string;
  closedAt: string | null;
  descriptionHash: string | null;
}

export interface Score {
  jobId: number;
  scorer: ScorerKind;
  model: string | null;
  promptVersion: string;
  descriptionHash: string;
  fitScore: number | null;
  verdict: Verdict;
  disqualifier: string | null;
  disqualifierQuote: string | null;
  matched: { requirement: string; resumeEvidence: string }[];
  gaps: { gap: string; severity: 'high' | 'medium' | 'low' }[];
  missingKeywords: string[];
}

/** Connector contract: one implementation per platform. */
export interface Connector {
  ats: Ats;
  fetchJobs(company: Company): Promise<FetchedJob[]>;
}

/** Scorer contract: ClaudeCodeScorer now, ApiScorer later. */
export interface Scorer {
  kind: ScorerKind;
  score(jobs: Job[], promptVersion: string): Promise<Score[]>;
}
