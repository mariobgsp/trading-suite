# Task for scout

Recon the repo at /home/mariobgsp/Project/github/trading-suite (a Next.js 16 + FastAPI trading dashboard) to assess a migration to TanStack Start + Hono + Bun. Read-only — do NOT edit files.
Report:
1. Frontend surface: inventory src/app/ routes and pages, src/components/ (Shell, Sidebar, MarketChart, ui), and src/lib/ (api client, polling/SSE hooks). For each, note Next.js-specific APIs used (useSearchParams, server components, the use client directive, next/image, next/link, caching, revalidation, route handlers, middleware, env vars like NEXT_PUBLIC_*).
2. Config surface: what next.config.ts contains (rewrites/proxies to the FastAPI backend? images config? headers?), how the frontend reaches the backend (proxy vs direct URL, SSE endpoints used, polling intervals), and anything in tsconfig.json / postcss / eslint that ties to Next.
3. Deployment/ops: Dockerfile(s), docker-compose.yml, scripts/run.sh, scripts/import_history.sh — how the app is built and run today, what ports, how the backend is started, any nginx/proxy layer.
4. Migration blast radius: which files would break first if the Next app were swapped (everything importing next/*, layout conventions, route conventions), which are framework-agnostic (lib/api client, chart components, pure UI), and any tests that cover frontend behavior.
Give file paths with approximate line ranges and a rough LOC count per area. End with: which parts are framework-clean vs framework-locked, and the cheapest staging path (e.g., what would let the app run under Bun/Hono with the least change). Keep it under 900 words.

---
**Output:**
Write your findings to exactly this path: /home/mariobgsp/Project/github/trading-suite/.pi-subagents/artifacts/outputs/8a580647/context.md
This path is authoritative for this run.
Ignore any other output filename or output path mentioned elsewhere, including output destinations in the base agent prompt, system prompt, or task instructions.

## Acceptance Contract
Acceptance level: attested
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Return concrete findings with file paths and severity when applicable

Required evidence: review-findings, residual-risks

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
`criteriaSatisfied[].status` must be exactly one of: satisfied, not-satisfied, not-applicable.
`commandsRun[].result` must be exactly one of: passed, failed, not-run.
`manualNotes` and `notes` are optional strings; an empty string means no note and does not satisfy `manual-notes` evidence.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```