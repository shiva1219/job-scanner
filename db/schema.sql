-- Job Scanner database schema (SQLite)
-- Version 1. Dates are ISO-8601 UTC text. Booleans are 0/1 integers.
-- Foreign keys must be switched on for every connection (src/db/index.ts does this).

PRAGMA foreign_keys = ON;

-- 1. Target companies (loaded from companies.csv)
CREATE TABLE IF NOT EXISTS companies (
  id                        INTEGER PRIMARY KEY,
  name                      TEXT    NOT NULL UNIQUE,
  priority                  TEXT    NOT NULL CHECK (priority IN ('A','B','C')),
  sector                    TEXT,
  hubs                      TEXT,                  -- e.g. 'TX (Plano), CA, Remote'
  path_fit                  TEXT,                  -- e.g. 'Full-stack, Frontend+AI'
  career_url                TEXT,
  ats                       TEXT    NOT NULL DEFAULT 'unknown'
                            CHECK (ats IN ('workday','greenhouse','lever','ashby','smartrecruiters',
                                           'oracle_hcm','eightfold','custom','unknown')),
  ats_id                    TEXT,                  -- Greenhouse token, Lever/Ashby slug, SmartRecruiters id
  workday_host              TEXT,                  -- e.g. 'capitalone.wd12.myworkdayjobs.com'
  workday_site              TEXT,                  -- e.g. 'Capital_One'
  ats_verified              INTEGER NOT NULL DEFAULT 0 CHECK (ats_verified IN (0,1)),
  h1b_continuing_approvals  INTEGER,               -- from USCIS Data Hub, filled by you
  active                    INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  notes                     TEXT,
  created_at                TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at                TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 2. Job postings: one row per posting per company
CREATE TABLE IF NOT EXISTS jobs (
  id                INTEGER PRIMARY KEY,
  company_id        INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  external_id       TEXT    NOT NULL,              -- the platform's own job id
  title             TEXT    NOT NULL,
  location          TEXT,
  is_remote         INTEGER NOT NULL DEFAULT 0 CHECK (is_remote IN (0,1)),
  url               TEXT    NOT NULL,              -- link you click to apply
  posted_at         TEXT,                          -- as reported by the platform, may be null
  first_seen_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_seen_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  closed_at         TEXT,                          -- set when the posting disappears
  description       TEXT,
  description_hash  TEXT,                          -- sha256 of normalized description
  raw_json          TEXT,                          -- original platform payload, for debugging
  UNIQUE (company_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_jobs_first_seen ON jobs(first_seen_at);
CREATE INDEX IF NOT EXISTS idx_jobs_open       ON jobs(closed_at);

-- 3. Rule filter result per job
CREATE TABLE IF NOT EXISTS filter_results (
  job_id             INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  filter_version     TEXT    NOT NULL,
  passed             INTEGER NOT NULL CHECK (passed IN (0,1)),
  reasons            TEXT    NOT NULL DEFAULT '[]', -- JSON array of rule ids that fired
  sponsorship_flag   INTEGER NOT NULL DEFAULT 0 CHECK (sponsorship_flag IN (0,1)),
  sponsorship_quote  TEXT,                          -- sentence that triggered the flag
  filtered_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (job_id, filter_version)
);

-- 4. Claude scores (never score the same posting twice for one prompt version)
CREATE TABLE IF NOT EXISTS scores (
  id                     INTEGER PRIMARY KEY,
  job_id                 INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  scorer                 TEXT    NOT NULL CHECK (scorer IN ('claude-code','api')),
  model                  TEXT,
  prompt_version         TEXT    NOT NULL,
  description_hash       TEXT    NOT NULL,
  fit_score              INTEGER CHECK (fit_score BETWEEN 0 AND 100),
  verdict                TEXT    NOT NULL
                         CHECK (verdict IN ('APPLY','APPLY_WITH_REFERRAL','SKIP','NEEDS_REVIEW')),
  disqualifier           TEXT,                      -- e.g. 'no_sponsorship', 'clearance', 'contract'
  disqualifier_quote     TEXT,
  matched_json           TEXT    NOT NULL DEFAULT '[]', -- [{requirement, resume_evidence}]
  gaps_json              TEXT    NOT NULL DEFAULT '[]', -- [{gap, severity}]
  missing_keywords_json  TEXT    NOT NULL DEFAULT '[]',
  raw_json               TEXT,
  scored_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (job_id, prompt_version, description_hash)
);
CREATE INDEX IF NOT EXISTS idx_scores_job ON scores(job_id, scored_at);

-- 5. Your application tracking
CREATE TABLE IF NOT EXISTS applications (
  job_id       INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'new'
               CHECK (status IN ('new','watching','applied','interviewing','offer','rejected','skipped')),
  applied_on   TEXT,
  channel      TEXT,                                -- referral, career site, recruiter, LinkedIn
  contact      TEXT,
  next_action  TEXT,
  due_on       TEXT,
  notes        TEXT,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 6. Your hand labels for the eval set
CREATE TABLE IF NOT EXISTS labels (
  job_id                       INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  your_verdict                 TEXT    NOT NULL CHECK (your_verdict IN ('APPLY','SKIP')),
  your_reason                  TEXT,
  has_sponsorship_restriction  INTEGER NOT NULL DEFAULT 0 CHECK (has_sponsorship_restriction IN (0,1)),
  labeled_at                   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 7. Fetch log: one row per company per run, so one failure never hides
CREATE TABLE IF NOT EXISTS fetch_log (
  id           INTEGER PRIMARY KEY,
  run_id       TEXT    NOT NULL,                    -- e.g. '2026-10-17T07:00:00Z'
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ats          TEXT    NOT NULL,
  status       TEXT    NOT NULL CHECK (status IN ('ok','error','skipped')),
  jobs_found   INTEGER NOT NULL DEFAULT 0,
  new_jobs     INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  duration_ms  INTEGER,
  fetched_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_fetch_log_run ON fetch_log(run_id);

-- Shortlist view: open, filter-passed jobs with their latest score, best first
CREATE VIEW IF NOT EXISTS v_shortlist AS
WITH latest AS (
  SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.job_id ORDER BY s.scored_at DESC, s.id DESC) AS rn
  FROM scores s
)
SELECT
  j.id AS job_id, c.name AS company, c.priority, j.title, j.location, j.is_remote, j.url,
  j.first_seen_at, l.fit_score, l.verdict, l.disqualifier, l.disqualifier_quote,
  l.prompt_version, COALESCE(a.status, 'new') AS status
FROM jobs j
JOIN companies c         ON c.id = j.company_id
JOIN filter_results f    ON f.job_id = j.id AND f.passed = 1
LEFT JOIN latest l       ON l.job_id = j.id AND l.rn = 1
LEFT JOIN applications a ON a.job_id = j.id
WHERE j.closed_at IS NULL
ORDER BY (l.verdict = 'APPLY') DESC, l.fit_score DESC, j.first_seen_at DESC;

PRAGMA user_version = 1;
