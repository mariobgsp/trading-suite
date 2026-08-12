# 003 — Consolidate easing tokens and add press feedback

- **Status**: TODO
- **Commit**: N/A
- **Severity**: LOW
- **Category**: Cohesion & Physicality
- **Estimated scope**: 1 file, CSS additions

## Problem

The dashboard uses the built-in CSS `ease-out` (which is too weak for deliberate motion) and has no shared easing tokens. Additionally, interactive buttons lack `:active` press feedback, making them feel unresponsive to touch/click.

```css
/* dashboard/src/index.css:858 — current */
.toast {
  /* ... */
  animation: slideIn .2s ease-out;
}
/* ... no :active states on buttons ... */
```

## Target

Define a strong `--ease-out` token, apply it to animations, and use it to add tactile press feedback to all buttons.

```css
/* target */
:root {
  /* ... existing vars ... */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
}

.toast {
  animation: slideIn 200ms var(--ease-out);
}
.fade-in {
  animation: fadeUp 200ms var(--ease-out) both;
}

.btn:active, .bb-fkey-btn:active, .date-range-btn:active {
  transform: scale(0.97);
  transition: transform 160ms var(--ease-out);
}
```

## Repo conventions to follow

CSS variables live in `:root` in `dashboard/src/index.css`.

## Steps

1. In `dashboard/src/index.css`, locate `:root` and add `--ease-out: cubic-bezier(0.23, 1, 0.32, 1);` at the end of the variable list.
2. Update `.toast` (line 858) to `animation: slideIn 200ms var(--ease-out);`.
3. Update `.fade-in` (line 881) to `animation: fadeUp 200ms var(--ease-out) both;`.
4. Add the button `:active` states block right after `.btn:hover` (around line 557):
```css
.btn:active, .bb-fkey-btn:active, .date-range-btn:active {
  transform: scale(0.97);
  transition: transform 160ms var(--ease-out);
}
```

## Boundaries

- Do NOT touch other animations or variables.

## Verification

- **Mechanical**: Run the UI using `npm run dev`.
- **Feel check**: Click any button (e.g., BUY, SELL). It should subtly scale down (0.97) immediately on press, and snap back when released.
- **Done when**: All buttons visually respond to clicks and `var(--ease-out)` is consistently applied.
