## Problem

Two issues, both in `src/styles.css`.

### 1. Build error (blocking)

Vite log:
```
[vite] Internal server error: Cannot apply unknown utility class `btn-base`
  Plugin: @tailwindcss/vite:generate:serve
  File: /dev-server/src/styles.css?direct
```

Tailwind v4 does not allow `@apply` to reference another **custom component class** defined in `@layer components`. `.btn-primary`, `.btn-secondary`, `.btn-danger` all do `@apply btn-base ...`, which Tailwind v4 rejects because `btn-base` is not a real utility — only true Tailwind utilities (or `@theme` tokens) are valid inside `@apply`.

Same pattern in the badges: `.badge-risk-high` etc. do `@apply badge-base ...`.

This makes the whole stylesheet fail to compile, so the preview shows an unstyled / broken page.

### 2. Primary color wrong (#2563EB rendering as a different blue)

Current token:
```css
--primary: oklch(0.546 0.245 262.881);   /* labelled #2563EB */
```

The chroma `0.245` is **out of sRGB gamut** for this hue. Browsers gamut-map it, producing a blue that is not `#2563EB` (closer to a brighter, more saturated blue — which is why it visually reads like `#007bff` / a different shade). The actual oklch for `#2563EB` is approximately:

```
oklch(54.6% 0.215 262.88)
```

Same issue for `--ring`, `--chart-1`, `--sidebar-primary`, `--sidebar-ring` (all use the same overinflated chroma).

The status colors have the same issue but to a lesser degree:
- `--danger` for `#DC2626` ≈ `oklch(57.7% 0.214 27.3)` (not `0.245`)
- `--success` for `#16A34A` ≈ `oklch(62.7% 0.184 149.2)` (not `0.194`)
- `--warning` for `#D97706` ≈ `oklch(68.1% 0.156 51.6)` (hue was also wrong: `75.834` is amber-500-ish, `#D97706` is closer to hue `51.6`)

## Fix

### Edit `src/styles.css`

**A. Replace `@apply btn-base` / `@apply badge-base` with the underlying utilities (no nested custom classes).**

Rewrite the `@layer components` block so `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.badge-risk-*`, `.badge-info`, `.badge-neutral` each inline the shared utilities directly. Keep `.btn-sm`, `.card-surface`, `.bottom-nav-item` as-is. Remove the now-unused `.btn-base` and `.badge-base` declarations (or, if we want to keep them as documentation, define them as plain CSS with raw properties — not via `@apply` of a non-utility).

Concretely, each button becomes:
```css
.btn-primary {
  @apply inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium
         transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-ring
         disabled:opacity-50 disabled:pointer-events-none
         px-4 py-2 text-sm bg-primary text-primary-foreground hover:opacity-90;
}
```
…and likewise for `.btn-secondary`, `.btn-danger`, `.badge-risk-high`, etc.

This resolves the Tailwind v4 build failure.

**B. Correct the oklch values so they actually equal the requested hex.**

In `:root`:
```css
--primary: oklch(0.546 0.215 262.88);     /* #2563EB */
--ring:    oklch(0.546 0.215 262.88);
--danger:  oklch(0.577 0.214 27.3);       /* #DC2626 */
--success: oklch(0.627 0.184 149.2);      /* #16A34A */
--warning: oklch(0.681 0.156 51.6);       /* #D97706 */
--chart-1: oklch(0.546 0.215 262.88);
--sidebar-primary: oklch(0.546 0.215 262.88);
--sidebar-ring:    oklch(0.546 0.215 262.88);
```

Leave `.dark` overrides as-is (they're a designed-darker variant, not a hex match).

### Vite cache

Tailwind v4's Vite plugin recompiles on file save and the error above is a parse-time failure, not a stale-cache issue — once `styles.css` parses cleanly, the preview recovers on its own. No manual cache wipe needed. If the preview still shows stale CSS after the fix, a single restart of the dev server is enough; we won't delete `node_modules/.vite` unless the error persists after the edit.

## Verification

After the edit:
1. `tail` the dev-server log and confirm no `Cannot apply unknown utility class` errors.
2. Inspect `--primary` in the preview's computed styles — `oklch(0.546 0.215 262.88)` should resolve to `rgb(37, 99, 235)` (= `#2563EB`).
3. Spot-check a `.btn-primary` and a `.badge-risk-high` render with the correct colors.

## Out of scope

No changes to data, routes, queries, risk calculations, or any component file. CSS-only fix in `src/styles.css`.
