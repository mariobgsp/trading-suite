# 001 — Fix unintended layout animations

- **Status**: TODO
- **Commit**: N/A
- **Severity**: HIGH
- **Category**: Performance
- **Estimated scope**: 1 file, small CSS changes

## Problem

Using `transition: all` is a strict performance violation because it forces the browser to animate unintended properties (like layout changes) off the GPU. This drops frames on heavy dashboard views when UI elements are hovered or activated. 

```css
/* dashboard/src/index.css:318 — current */
.bb-fkey-btn {
  /* ... */
  transition: all .15s;
}

/* dashboard/src/index.css:553 — current */
.btn {
  /* ... */
  transition: all .15s;
}

/* dashboard/src/index.css:908 — current */
.date-range-btn {
  /* ... */
  transition: all .15s;
}
```

## Target

Explicitly target only the properties that change on hover/active states (background, color, border-color).

```css
/* target */
.bb-fkey-btn {
  /* ... */
  transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
}

.btn {
  /* ... */
  transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
}

.date-range-btn {
  /* ... */
  transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
}
```

## Repo conventions to follow

The repo uses plain CSS in `dashboard/src/index.css`.

## Steps

1. In `dashboard/src/index.css`, locate `.bb-fkey-btn` (around line 319) and replace `transition: all .15s;` with `transition: background 150ms ease, color 150ms ease, border-color 150ms ease;`.
2. Locate `.btn` (around line 554) and replace `transition: all .15s;` with `transition: background 150ms ease, color 150ms ease, border-color 150ms ease;`.
3. Locate `.date-range-btn` (around line 909) and replace `transition: all .15s;` with `transition: background 150ms ease, color 150ms ease, border-color 150ms ease;`.

## Boundaries

- Do NOT touch other CSS properties in these classes.
- Do NOT change markup/structure.

## Verification

- **Mechanical**: Run the UI using `npm run dev` in `dashboard`.
- **Feel check**: Hover over the main tab buttons, trade buttons, and date range buttons.
  - They should change color exactly as they did before.
  - In DevTools, set playback to 10% (Animations panel) and confirm only color/background are transitioning.
- **Done when**: `transition: all` is removed from all button classes.
