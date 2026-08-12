# Task for researcher

Research the PRACTICAL TRADEOFFS of three migration targets for a Next.js 16 trading dashboard (React 19, lightweight-charts, SSE from a FastAPI backend): (a) full swap to TanStack Start, (b) Hono+Bun replacing only the server/runtime while keeping React on top (e.g., Vite + TanStack Router + Hono), (c) staged: adopt Bun as runtime for Next.js first, then Hono as a thin API gateway in front of FastAPI, keep Next for UI. Do NOT edit files — research only.
Cover:
1. Migration cost and risk per option: breaking changes, router paradigm shift (file-based vs TanStack Router code-based routes), server function/data loading model, SSR streaming for a dashboard, image optimization and static assets, middleware/auth, caching and revalidation semantics.
2. SSE and long-lived connections: how each target handles Server-Sent Events (Bun.serve, Hono streamSSE, TanStack Start SSR), known buffering/proxy issues, and whether Bun is production-stable for many concurrent long-lived connections.
3. Ecosystem and maintenance: npm/registry compat of Bun, ecosystem maturity of TanStack Start vs Next vs plain Hono, hiring/docs/community size, deployment targets (Docker, VPS, serverless) for each, and bundle/build tooling (Vite vs Next compiler vs Nitro/Vinxi).
4. How to VALIDATE cheaply: what a pilot would look like (e.g., run bun next dev today, or port ONE page to Hono+TanStack Router, or use Hono as a proxy) and what success metrics would tell you the migration is worth it.
Compare the three options in a short table plus prose. Give source links with dates and confidence. End with a clear recommendation for a dashboard app that is client-heavy, chart-heavy, and already depends on a separate Python API. Keep it under 900 words.

---
**Output:**
Write your findings to exactly this path: /home/mariobgsp/Project/github/trading-suite/.pi-subagents/artifacts/outputs/0532b7db/research.md
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