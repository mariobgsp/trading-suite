# Task for researcher

Research design precedent + tradeoffs for porting a consumer landing-page "apps grid" design language onto a dark, data-dense trading dashboard.
Context: trading-suite is a dark-mode Indonesian stock platform (Next.js 16, Tailwind v4, React 19) with 8 pages: Overview, Markets, Portfolio, Backtest, Screener, Validator, Sentiment Radar, Regime & Bot. It currently uses CSS vars (--bg, --panel, --border, --text, --accent) and lightweight-charts. We want to implement an "apps" launchpad section in the style of https://www.klinikpenyesalan.com/#apps and/or a premium card design system.
Questions:
1. What design patterns work for an "apps grid / launcher" section in a dashboard (card anatomy, grouping by category, icons, hover motion)? Cite concrete examples.
2. Risks of mixing a marketing-page aesthetic (large hero type, gradients, white space) with dense trading data tables: density mismatch, information hierarchy, readability. What mitigations exist?
3. How should per-app accent colors + a shared dark token system be structured in Tailwind v4 (@theme CSS variables) for maintainability?
4. Accessibility + performance: motion preferences (prefers-reduced-motion), contrast on dark backgrounds, animation cost.
5. What is the cheapest way to validate a visual redesign: next build/lint, screenshot testing, component-level checks?
Return: concise findings with source links, confidence, gaps. Prefer 2025/2026 sources. Do NOT edit files.

---
**Output:**
Write your findings to exactly this path: /home/mariobgsp/Project/github/trading-suite/.pi-subagents/artifacts/outputs/2ac001ad/research.md
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