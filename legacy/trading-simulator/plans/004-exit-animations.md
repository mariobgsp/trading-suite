# 004 — Add exit animations to prevent jarring state changes

- **Status**: TODO
- **Commit**: N/A
- **Severity**: MEDIUM
- **Category**: Missed opportunities
- **Estimated scope**: 3 files, React structural tweaks for unmounting.

## Problem

Modals, Toasts, and Watchlist items currently "teleport" out of existence instantly when closed/removed, violating spatial consistency and creating a jarring experience.

```tsx
/* dashboard/src/App.tsx:567 — current */
{showTrade && (
  <TradeModal ... onClose={() => setShowTrade(false)} />
)}
```

## Target

Toasts and modals should gracefully animate out before unmounting.

For Modals (example approach for `TradeModal`):
Instead of instant unmount, the modal should trigger a `.fade-out` class, wait 200ms, and then unmount.

```css
/* target in index.css */
.fade-out { animation: fadeDown 200ms ease-in both; }
@keyframes fadeDown {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(4px); }
}

.toast-exit { animation: slideOut 200ms ease-in both; }
@keyframes slideOut {
  from { opacity: 1; transform: translateX(0); }
  to { opacity: 0; transform: translateX(100%); }
}
```

## Repo conventions to follow

The codebase uses plain React state without animation libraries like Framer Motion. To fix unmount animations in vanilla React, you must intercept the close action, set a local `isClosing` state to trigger the exit CSS animation, and use `setTimeout` (or `onAnimationEnd`) to finally call the parent's `onClose`.

## Steps

1. **CSS**: In `dashboard/src/index.css`, add `@keyframes fadeDown`, `.fade-out`, `@keyframes slideOut`, and `.toast-exit` keyframes (using the target definitions above).
2. **Modals**: In `TradeModal.tsx` and `PendingOrderModal.tsx`:
   - Add `const [isClosing, setIsClosing] = useState(false);`
   - Create `const handleClose = () => { setIsClosing(true); setTimeout(onClose, 200); }`
   - Use `handleClose` instead of `onClose` in the overlay click and Cancel buttons.
   - Change the modal's container class to `` className={`modal ${isClosing ? 'fade-out' : 'fade-in'}`} ``.
3. **Toasts**: In `App.tsx`, the `toast` function removes the toast instantly after 4000ms. Modify the logic to mark the toast as `isClosing: true` at 3800ms, and remove it at 4000ms. Apply `.toast-exit` when `isClosing` is true.

## Boundaries

- Do NOT install `framer-motion` or other heavy animation libraries for this. Adhere to vanilla React/CSS.

## Verification

- **Feel check**: Open the Trade modal and click Cancel. It should fade down over 200ms before disappearing. Trigger a toast; wait 4 seconds, it should slide out to the right (`translateX(100%)`).
- **Done when**: Exit animations are visually confirmed for modals and toasts.
