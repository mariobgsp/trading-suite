# Task for scout

Inspect the trading-suite repo at /home/mariobgsp/Project/github/trading-suite and report on everything relevant to redesigning it as an app-launcher / apps-section style dashboard.
Report with file paths and line ranges:
- Full src/ tree; list every page route (src/app/*/page.tsx) and what each does (backend endpoint it talks to).
- src/app/globals.css: the full design-token set (CSS variables), utility classes (.panel, .panel-2, .grid-texture, skeleton, etc.), Tailwind v4 setup (@theme? @import "tailwindcss"?), fonts.
- src/components/ui.tsx: exported components and their props.
- src/components/Shell.tsx and Sidebar.tsx: layout shell, nav items, icons used.
- How charts are done today (lightweight-charts via src/components/MarketChart.tsx): props, theme handling.
- package.json scripts (lint/build/typecheck), eslint config, next.config.ts, whether the app is dark-mode only.
- Whether anything like an apps grid, icon set, or landing page exists already.
Also check: does the repo have a `.dark` class on <html> (layout.tsx)? Is there a `liveline` dependency now (I installed it)?
Return: compressed findings with evidence (paths + lines). Confidence level and gaps. Do NOT edit files.

---
**Output:**
Write your findings to exactly this path: /home/mariobgsp/Project/github/trading-suite/.pi-subagents/artifacts/outputs/09babe03/context.md
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