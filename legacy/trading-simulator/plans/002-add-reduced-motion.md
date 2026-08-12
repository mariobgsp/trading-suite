# 002 — Add reduced motion support

- **Status**: TODO
- **Commit**: N/A
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 1 file, medium CSS addition

## Problem

The UI uses movement animations (`slideIn` for toasts, `fadeUp` for modals) but lacks `@media (prefers-reduced-motion: reduce)` entirely. This forces spatial movement on all users, which is an accessibility violation.

## Target

A media query block at the end of the stylesheet that intercepts movement keyframes and replaces them with pure opacity fades.

```css
/* target (add to bottom of index.css) */
@media (prefers-reduced-motion: reduce) {
  .toast {
    animation-name: reducedFadeIn !important;
  }
  .fade-in {
    animation-name: reducedFadeIn !important;
  }
}

@keyframes reducedFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

## Repo conventions to follow

The repo uses plain CSS in `dashboard/src/index.css`.

## Steps

1. Open `dashboard/src/index.css`.
2. Append the target `@media (prefers-reduced-motion: reduce)` block and the `@keyframes reducedFadeIn` definition to the very bottom of the file.

## Boundaries

- Do NOT touch existing keyframes (`fadeUp`, `slideIn`). We are overriding their application, not deleting them.

## Verification

- **Mechanical**: Run the UI using `npm run dev`.
- **Feel check**: Trigger a modal (click BUY) and a toast (submit an order).
  - Open DevTools -> Rendering panel -> Emulate CSS media feature `prefers-reduced-motion: reduce`.
  - Trigger the modal/toast again. They should fade in via opacity ONLY, with absolutely zero spatial movement.
- **Done when**: The media query is in place and verified working.
