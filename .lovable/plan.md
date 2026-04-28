# Fix: App not loading — stray closing tag in clubs.tsx

## Root cause

The dev server is failing to compile `src/routes/clubs.tsx` with a JSX syntax error:

```
593 |   <ScoreVariationSection row={row} />
594 |   </section>
    |   ^
```

`ScoreVariationSection` is a self-closing component (defined at line 1175 as a stub), and the preceding `<section>` for the score block was already closed at line 591. The `</section>` on line 594 is unmatched, which breaks the JSX tree.

Because `clubs.tsx` is imported by `routeTree.gen.ts`, the whole router module fails to load → the app shell never mounts → no data shows on any page (including `/`).

## Fix

Remove the stray `</section>` on line 594 of `src/routes/clubs.tsx`. Single-line surgical delete; no other changes.

## Verification

- Dev server log should stop reporting the parse error.
- Home page `/` and `/clubs` render their data again.
