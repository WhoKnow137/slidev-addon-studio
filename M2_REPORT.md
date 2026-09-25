# M2 — Essential typography inspector

**Status:** complete, 25 September 2026. Scope is M2 only.

**Implementation commit:** `43d0ceec73b56734433e0d90c409ee311c7ed311` on `feature/studiotext-v2`, based directly on public-safe M1 commit `f321724fb25e71d872e4f828306953e34beff80d`. The fixture and browser evidence are synthetic. The private deck and its notes are absent from this branch.

## What changed

The inspector now selects one managed `StudioText v1` object on single click and offers a dedicated Typography panel in `client/ui/TypographyInspector.vue`. Double click enters M1's model-backed text selection mode. The panel covers family, numeric weight, normal/italic/oblique style, size, color swatch and hex, line height, letter spacing, B/I/U/S toggles, horizontal and vertical alignment, non-destructive case, and scoped undo/redo. An unsupported subtree displays its parser reason and disables visual controls. The earlier floating size/color control was removed; the guarded M1 `format` API remains for compatibility.

`shared/typography.ts` is the single resolution and mutation layer. `resolveCharacterProperty`, `resolveParagraphAlignment`, `resolveVerticalAlignment`, and `resolveToggle` return `value`, `mixed`, or `unavailable` with a reason. Resolution uses the typed source document, not DOM computed style. Character values cascade from `StudioText` defaults to `StudioRun` overrides; caret `typingStyle` overlays the effective style for future insertion only. Paragraph alignment uses a paragraph override or the document default. Vertical alignment belongs to the object.

`applyTypography` separates three mutation domains. Object selection changes character defaults. Text ranges use the shared grapheme-safe `mapCharacterRange` splitter and normalizer. A caret records a selection-only typing-style transaction and leaves source bytes unchanged. Horizontal alignment changes the document default for object selection, the current paragraph for a caret, or each intersected paragraph for a range. Object-level alignment clears existing paragraph overrides. Vertical alignment always changes the owning object, including when the selection is inside its text.

The M1 service in `node/studio-text-service.ts` handles every M2 command under the same file revision guard, unique-ID check, per-file queue, atomic source replacement, and per-session history. A no-op does not write or enter history. Caret formatting enters that history without writing the file. Undo availability is scoped to the selected file and object. Inspector fields commit on change/blur or Enter, so typing a multi-digit value creates one source transaction.

The v1 grammar now allows object-level `decoration` and `text-case`, alongside existing run-level forms. Supported decoration values are `none`, `underline`, `line-through`, and `underline line-through`; the two toggles preserve each other. Case values are `none`, `uppercase`, `lowercase`, and `capitalize`. Case never changes characters in the source. Family strings are preserved, including quoted multiword names. Weight accepts finite numeric values from 1 to 1000. Colors accept 6- or 8-digit hex. Line height accepts `normal`, unitless numbers, `px`, and `%`; letter spacing accepts zero, `px`, and `em`, including negative decimals. Invalid and dynamic expressions remain read-only or rejected. Normalization removes redundant run overrides and merges identical adjacent runs only after an effective change. A no-op keeps the original bytes.

The render components now distinguish an inherited underline from a run that explicitly turns it off. Fixed-height text uses a flex content wrapper for top, center, and bottom alignment. The synthetic browser fixture measured relative text positions of **0**, **54.25**, and **108.50** pixels for those three settings. No position, size, rotation, drag, resize, snapping, or zoom editor logic was changed.

## Files

The implementation commit changes 34 files. Main code: `client/ui/TypographyInspector.vue`, `client/ui/panels/PanelInspect.vue`, `client/studiotext-editor.ts`, `client/composables/useSelection.ts`, `shared/typography.ts`, `shared/studiotext.ts`, `node/studio-text-service.ts`, `components/StudioText.vue`, `components/StudioRun.vue`, `components/StudioParagraph.vue`, `components/studio-decoration.ts`, and `styles/studio.css`. Tests and evidence: `test/typography.test.ts`, `test/typography-service.test.ts`, `m1/e2e.mjs`, and `m2/`. The old `client/ui/StudioTextControls.vue` is removed. Fixture render components under `m1/` and `m2/` were kept in sync for standalone Slidev checks.

## Verification

| Check | Result |
|---|---|
| `pnpm test` | 252 passed, 1 previously skipped; 13 test files passed |
| `pnpm typecheck` | Passed |
| `node m1/e2e.mjs` | Passed: word range, color/size, reload, undo/redo, minimal diff, guard regressions |
| `node m2/e2e.mjs` | Passed: object and word-range edits, caret style, retained selection, mixed state, reload, undo/redo, unsupported reason, inherited decoration, and visible vertical alignment |
| `pnpm exec slidev build m2/fixture/slides.md --out _build` | Passed with addon, 553 modules |
| `pnpm exec slidev build m2/fixture/slides-formatted-plain.md --out _build-plain` | Passed without addon, 457 modules |

Browser evidence is recorded in `m2/e2e-results.json` and `m2/e2e-final.png`. The test restores its writable source fixture after execution; `m2/fixture/pages/002-formatted.md` is a synthetic saved example for the plain Slidev build.

## M2 acceptance

| # | Gate | Status | Evidence |
|---:|---|---|---|
| 1 | Dedicated typography inspector | PASS | `TypographyInspector.vue`, managed-only panel route |
| 2 | Font family | PASS | Object/range/caret model and guarded tests; browser object edit |
| 3 | Font weight | PASS | Numeric model tests, browser object and word edit |
| 4 | Font style | PASS | Normal/italic/oblique model and transaction tests |
| 5 | Font size | PASS | Decimal model tests, browser object and word edit |
| 6 | Text color | PASS | Hex/alpha validation, swatch and hex input, browser edit |
| 7 | Line height | PASS | Canonical variants and guarded tests; browser object edit |
| 8 | Letter spacing | PASS | Zero/negative/decimal/unit tests; browser object edit |
| 9 | Horizontal alignment | PASS | Four-value paragraph tests and browser edit |
| 10 | Vertical alignment | PASS | Three-value source tests and measured browser positions |
| 11 | Bold | PASS | 400/700 toggle and nonstandard-weight protection tests |
| 12 | Italic | PASS | Normal/italic toggle and oblique protection tests |
| 13 | Underline | PASS | Independent toggle tests and browser word edit |
| 14 | Strikethrough | PASS | Independent toggle and guarded undo/redo tests |
| 15 | Non-destructive case | PASS | Source-character tests, CSS render and browser reload |
| 16 | Object/range/caret scopes | PASS | Parameterized tests for every character property; browser paths |
| 17 | Mixed values | PASS | Per-property full-range tests and browser mixed-size state |
| 18 | Effective inherited equality | PASS | Default-plus-run equality test; central cascade |
| 19 | Unavailable reason | PASS | Parser reason in inspector, disabled controls, browser assertion |
| 20 | Range survives inspector focus | PASS | Browser field-focus and retained-word-selection assertions |
| 21 | Deterministic normalization | PASS | Merge/redundant-override and round-trip tests |
| 22 | Guarded M1 transactions | PASS | All commands use `StudioTextService.command` and revision checks |
| 23 | Undo/redo every property | PASS | Parameterized character/toggle, all alignment values, caret, browser tests |
| 24 | Reload preserves persisted properties | PASS | Per-property service status reparse, alignment tests, browser reload |
| 25 | Minimal source diffs | PASS | Per-property unrelated-subtree/notes byte assertions; browser fixture |
| 26 | Unsupported markup untouched | PASS | Service refusal and browser disabled-reason assertion |
| 27 | M1 stale/duplicate/concurrency | PASS | Service regression tests and M1 browser test |
| 28 | Full suite | PASS | 252 passed, 1 skipped |
| 29 | Typecheck | PASS | `tsc --noEmit` |
| 30 | Browser E2E | PASS | M1 and M2 headless Chrome scripts |

## Boundaries

Caret typing style is an in-session, undoable selection state. M2 does not insert characters, so its effect on future typing will be connected and tested with later editing work; it does not survive a full browser restart as source content. The `value`/`mixed`/`unavailable` model applies to managed `StudioText v1`, while arbitrary Vue/HTML remains source-editable and visually read-only. The panel does not discover installed fonts or promise that a named family is available; font catalog and exact Figma metrics belong to later milestones. Vertical alignment visibly positions content in a fixed-height box; an auto-height box has no spare vertical space to distribute. Range-level line height is serialized and rendered as CSS on runs; browser line-box behavior follows CSS and may differ from Figma. M3 geometry, M4 converter migration, and M5 advanced typography were not started.

**M2 complete. Ready for M3 — Geometry contract.**
