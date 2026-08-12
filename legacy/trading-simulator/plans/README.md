# Animation Improvement Plans

This directory contains self-contained plans to improve the motion and animation of this dashboard. These plans can be handed to any agent to execute (`improve-animations execute <plan-file>`).

| Plan | Title | Severity | Status |
| --- | --- | --- | --- |
| `001-fix-transition-all.md` | Fix unintended layout animations (`transition: all`) | HIGH | DONE |
| `002-add-reduced-motion.md` | Add reduced motion support | MEDIUM | DONE |
| `003-easing-tokens-and-press.md` | Consolidate easing tokens and add press feedback | LOW | DONE |
| `004-exit-animations.md` | Add exit animations to prevent jarring state changes | MEDIUM | DONE |

## Recommended Execution Order

1. **`001-fix-transition-all.md`**: Fix this first, as resolving layout thrashing is the highest priority for performance.
2. **`003-easing-tokens-and-press.md`**: Execute this next to establish the `--ease-out` token and tactile press feedback across the app.
3. **`004-exit-animations.md`**: Implements the exit animations. This requires minor structural tweaks in React, which should be done before tying up accessibility loose ends.
4. **`002-add-reduced-motion.md`**: Execute this last to ensure the `@media (prefers-reduced-motion: reduce)` block catches all newly added motion (such as the new exit animations).
