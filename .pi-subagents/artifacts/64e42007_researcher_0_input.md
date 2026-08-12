# Task for researcher

Research the CURRENT (2025-2026) state of migrating a Next.js 16 App Router app to TanStack Start, Hono, and Bun. Repo context only: it is a React 19 + TypeScript + Tailwind 4 trading dashboard (Next.js 16.3.0) that calls a FastAPI backend via REST + SSE. Do NOT edit files — research only.
Investigate:
1. TanStack Start production-readiness today: current version, what it runs on (Vinxi/Nitro), Router + server functions + SSR story, SSR streaming, middleware, data loading (loaders), how it compares to Next.js App Router for a data-heavy dashboard with charts (lightweight-charts) and SSE streams.
2. Hono as the server layer: current version, JSX/server components story, streaming, SSE/WebSocket support, middleware ecosystem, deployment targets (Bun, Node, Deno, Cloudflare Workers, edge), and whether it is typically used standalone or inside TanStack Start.
3. Bun as runtime: current version, Bun.serve, Bun as a Next.js-compatible runtime (can Bun run next dev / next start in 2026?), Bun vs Node for Hono performance benchmarks (requests/sec, cold start), known production issues (npm compat, native modules, node: compat gaps).
4. Migration evidence: official migration guides (TanStack Start from Next.js, Hono from Express/Next API routes), real-world blog posts/issue threads on migrating Next.js apps to TanStack Start or Hono+Bun in 2025-2026, common pain points (router differences, server functions model, file conventions, auth, i18n, image optimization, caching).
5. Anything about running SSE through Hono/TanStack Start and whether Bun handles long-lived connections well.
Return CONCISE findings with evidence: source links (official docs, GitHub issues, benchmarks, blog posts) with dates, exact package versions you verified, confidence level per finding, and gaps in the evidence. End with a recommended migration posture (full swap vs staged) based on what you found. Keep it under 900 words.

---
**Output:**
Write your findings to exactly this path: /home/mariobgsp/Project/github/trading-suite/.pi-subagents/artifacts/outputs/64e42007/research.md
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