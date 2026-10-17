# Fix Model Selection Box Border Break Issue

## Problem

In the `/model` selection dialog (rendered by `ModelsTab` in `src/components/ModelsTab.tsx`), the outer blue border box has broken segments where the inner search-input box overlaps it. The inner text input box (`width="100%"`, `borderStyle="single"`) pushes against the outer box's left/right borders, causing the blue line to break and the outer box to appear misaligned.

## Root Cause

`ModelsTab.tsx:145` — outer box is `width={65}` (fixed), but the inner search input box at `ModelsTab.tsx:185` is `width="100%"` with `borderStyle="single"`. The inner box's single-line border (1 char each side) plus padding (`paddingX={1}`) consumes the full outer width, so the inner box's border overlaps the outer box's border. The outer border then breaks at the overlap points.

Compare: `ProviderModal.tsx:148` uses `width={78}` and does NOT have this problem because it has more horizontal room.

## Solution

Increase the outer box width from `65` to `78` (matching `ProviderModal`) so the inner box's border and padding have room without overlapping the outer border.

### Files to change

**`src/components/ModelsTab.tsx`** — line 145

```diff
-        width={65}
+        width={78}
```

## Why this fixes it

- The outer box gains 13 characters of horizontal space
- The inner search box (`width="100%"`) expands to fill the new width
- The inner box's `borderStyle="single"` (1 char each side) + `paddingX={1}` (1 char each side) = 4 chars of border/padding
- With 65 width, the inner content area is 65 - 4 = 61 chars; the inner box border sits exactly on the outer border → break
- With 78 width, the inner content area is 78 - 4 = 74 chars; the inner box border sits inside the outer border → clean separation

## Validation

1. Run the app and open `/model` selection dialog
2. Verify the outer blue border is continuous (no breaks)
3. Verify the inner search box is fully visible and clickable
4. Verify keyboard navigation (↑/↓/Enter/Tab/Esc) still works
5. Compare with `/settings` provider selection box — should look identical

## Scope

- Single-line change in `ModelsTab.tsx`
- No logic changes, no API changes
- No tests needed (visual regression only)
- Safe to implement by any agent