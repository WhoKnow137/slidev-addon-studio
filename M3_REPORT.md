# M3 — Managed StudioText geometry

**Status:** complete, 25 September 2026. Scope is M3 only. The implementation is commit `f8e34665c689e533810b87f361dbae94857b6b93` on `feature/studiotext-v3`, based on the accepted M2 report commit `1c198963860ee5a64f4009e6518ae83d986c0cbe`. All fixtures and screenshots are synthetic; no private deck content is in this branch.

## Implementation and files

The geometry model is part of `TextDocument.geometry` in `shared/studiotext.ts`: slide-unit `x`, `y`, nullable `width` and `height`, `rotationDeg`, optional Auto Width `maxWidth`, and an optional affine tuple. `shared/geometry.ts` applies typed operations for fields, translation, resize, scale, mode transitions, and a completed gesture frame. Arbitrary affine tuples are parsed and preserved, but their geometry controls are read-only. The parser rejects frames that disagree with their resize mode.

`client/ui/GeometryInspector.vue` supplies X, Y, W, H, mode, rotation, and an explicit Scale action. `client/composables/useTextGeometryGizmo.ts` previews drag, eight-handle resize, and rotation in the rendered component, then sends one final typed command. `client/studio-text-measurement.ts` waits for the current source frame, font readiness, and rendered layout before a measured dimension is used. `client/ui/SelectionLayer.vue`, `client/ui/StudioRoot.vue`, `client/context.ts`, `client/composables/useSelection.ts`, `client/studiotext-editor.ts`, and `client/ui/panels/PanelInspect.vue` connect selection, handles, keyboard commands, errors, and the inspector to the guarded M1 service.

`node/studio-text-service.ts` adds guarded `geometry` and `geometry-batch` actions under the existing per-file queue and revision checks. Geometry-only commands patch changed opening-tag attributes in the selected `StudioText` span; Scale serializes that selected subtree because it also changes typography. Both routes validate the candidate and preserve unrelated Markdown, other objects, and notes. Batch translation or absolute X/Y edits of 2–20 managed text objects on the same slide/source file replace the whole file atomically and enter history as one transaction. Either member can invoke that batch undo/redo. A stale source revision refuses a gesture without a write or history entry.

`components/StudioText.vue` and the M1, M2, and M3 fixture component copies render all three modes, negative rotation, and visible Fixed Size overflow. `test/geometry.test.ts` and `test/geometry-service.test.ts` cover geometry semantics and guarded source transactions. `m3/fixture/` contains synthetic source and a saved formatted page; `m3/e2e.mjs`, `m3/e2e-results.json`, and `m3/e2e-final.png` provide browser evidence. The M1 browser test was updated for managed text's eight handles; its original evidence files remain unchanged.

## Coordinate, measurement, and interaction contract

Numeric X/Y/W/H values are **slide units**. `screenToSlide` and `slideToScreen` in `shared/geometry.ts` use the sampled slide rectangle and `useSlideCanvas.scale`; pointer deltas never enter source as screen pixels. The browser exercises 50%, 100%, and 200% relative zoom, while pure tests exercise 25%, 50%, 100%, 200%, and 400% for a logical +100 X move and +100 local-width resize. The same math is used by dragging and resize handles. Source values are rounded to six decimal places and near-integer pointer noise is collapsed; inspector display uses two decimals. Angles normalize to `[-180°, 180°)`.

Auto dimensions remain `auto` in source. `measureStudioText` waits for `document.fonts.ready`, the current `data-studio-text-pos`, the current mode/font size, and two animation frames. It samples computed used width/height when a transition, scale, or gesture requires a concrete frame. Measurement is never written merely because content or typography changes. The browser fixture proves Auto Width grows after text changes and Auto Height grows after both longer text and a font-size change, while their source constraints stay `auto`.

| Transition | Result |
|---|---|
| Auto Width → Auto Height | Freeze measured width; keep height `auto`. |
| Auto Width → Fixed Size | Freeze measured width and height. |
| Auto Height → Auto Width | Release width; keep width/height `auto`. |
| Auto Height → Fixed Size | Keep explicit width; freeze measured height. |
| Fixed Size → Auto Width | Release width and height. |
| Fixed Size → Auto Height | Keep explicit width; release height. |

Typing a W in Auto Width similarly creates Auto Height; typing an H in either auto mode creates Fixed Size. Horizontal resizing follows that rule; vertical resizing freezes height. Fixed Size keeps its explicit W/H and `overflow: visible`. The browser fixture forces content beyond its 400×200 frame and checks both the fixed dimensions and overflow policy.

Dragging changes X/Y only. Resize changes the frame only, preserving font size, spacing, colors, and styled runs. Its pointer delta is rotated into object-local axes; the center shift is rotated back before computing the new X/Y. Pure tests cover movement and width, height, and corner resize at 0°, 30°, 45°, and 90°. The browser additionally resizes, moves, rotates, selects a word, and changes that word's color at 45°. Rotation is numeric or by pointer; Shift snaps pointer rotation to 15° increments.

Scale is a separate explicit action. It scales the frame around its center plus default and run font sizes, absolute pixel line height/letter spacing, and Auto Width max width. It leaves unitless line height and relative `em`/`%` values relative. The browser verifies a 2× scale changes the default 48px to 96px and a 72px styled run to 144px, then undo restores the original. A normal resize of the same frame keeps both original font sizes.

Snapping reuses Studio's `snapBox`: slide edges, center, thirds, and other object edges/centers. The threshold is `6 / canvas.scale` slide units, or about six screen pixels at every zoom. Guides are drawn during preview; Alt disables snapping. Pure tests cover slide and peer targets and threshold at five zooms. The browser checks a visible center guide, snapped source coordinate, and an unsnapped Alt drag. Keyboard arrows nudge by one slide unit, or ten with Shift, when an object is selected. In caret editing, arrow keys keep the text frame unchanged.

## Verification

| Check | Result |
|---|---|
| Full `vitest run` | **PASS:** 275 tests passed, 1 existing skipped; 15 test files passed. |
| `tsc --noEmit` | **PASS**. |
| M3 Chrome E2E, `node m3/e2e.mjs` | **PASS:** numeric fields, resize/Scale, modes, text growth, font remeasurement, fixed overflow, snapping/Alt, keyboard, zoom, multi-object, rotated edit, stale gesture. |
| M1 Chrome E2E, `node m1/e2e.mjs` | **PASS:** double-click, range, color/size, reload, undo/redo, minimal diff. |
| M2 Chrome E2E, `node m2/e2e.mjs` | **PASS:** object/range typography, reload, undo/redo, mixed and unsupported states. |
| Slidev build with Studio addon | **PASS:** `slidev build m3/fixture/slides.md`, 558 modules. |
| Plain Slidev build without addon | **PASS:** `slidev build m3/fixture/slides-plain.md`, 457 modules. |

The addon build emitted only component-name conflict notices for fixture-local copies also supplied by the addon; the build completed. Build directories are generated output and are not committed. M3's source fixture is restored by the browser test after every run. The browser result JSON records the SHA-256 of its original fixture: `76aff88a5407711861be92a49241572cb1aa7c46f1507842e83c2de7e93806cf`.

## M3 acceptance gate

| # | Requirement | Status | Evidence |
|---:|---|---|---|
| 1 | X numeric editing | PASS | M3 browser source edit. |
| 2 | Y numeric editing | PASS | M3 browser source edit. |
| 3 | Width semantics | PASS | Numeric-set/mode/resize unit tests and browser handle resize. |
| 4 | Height semantics | PASS | Numeric-set/mode/resize unit tests and browser handle resize. |
| 5 | Rotation numeric editing | PASS | M3 browser 45° and reset. |
| 6 | Pointer dragging | PASS | M3 browser move and zoom cases. |
| 7 | Resize handles | PASS | Eight handles in M3 browser; M1 handle regression. |
| 8 | One transaction per resize gesture | PASS | Final-frame command on pointerup; service undo/redo test. |
| 9 | Scale distinct from resize | PASS | Separate typed actions; M3 browser comparison. |
| 10 | Scale adjusts typography | PASS | Default/run sizes and absolute spacing unit/browser tests. |
| 11 | Auto Width | PASS | Browser text growth, `auto,auto` source unchanged. |
| 12 | Auto Height | PASS | Browser text and font growth, auto height source unchanged. |
| 13 | Fixed Size | PASS | Explicit frame and browser overflow test. |
| 14 | Six deterministic mode transitions | PASS | Six cases in `geometry.test.ts`. |
| 15 | Fixed overflow explicit and tested | PASS | `overflow: visible`, 400×200 browser frame, content scroll height > 200. |
| 16 | Measurement leaves auto constraints intact | PASS | Browser text/font growth source assertions. |
| 17 | Central screen↔slide conversion | PASS | `shared/geometry.ts` conversion functions used by gizmo. |
| 18 | 25/50/100/200/400% zoom correctness | PASS | Pure +100 X/local-width matrix; browser 50/100/200%. |
| 19 | Multiple-angle rotation | PASS | 0/30/45/90° move, width/height/corner pure tests. |
| 20 | Rotated text editable | PASS | 45° browser word range and color edit. |
| 21 | Snap to slide center | PASS | Pure test and M3 browser guide/source assertion. |
| 22 | Snap to slide edges | PASS | Pure snap test at five zooms. |
| 23 | Snap to object centers/edges | PASS | Pure peer edge/center test at five zooms. |
| 24 | Consistent snap tolerance | PASS | Six-screen-pixel threshold tests at five zooms. |
| 25 | Keyboard nudging | PASS | Browser +1 and Shift +10 source edits. |
| 26 | Caret arrows do not move object | PASS | Rotated editing browser source equality. |
| 27 | Multi-object translation/safe scope | PASS | Same-file two-object atomic X edit and drag; unsupported operations refused. |
| 28 | Mixed geometry state | PASS | Browser mixed X, shared X commit for both. |
| 29 | Resize preserves typography | PASS | Unit structural equality and browser default/run assertions. |
| 30 | Scale preserves styled-run relation | PASS | 48→96 and 72→144 browser; run tests. |
| 31 | Minimal source diffs | PASS | Opening-tag patch and service untouched Markdown/notes tests. |
| 32 | Deterministic serialization | PASS | Parse/serialize round trip and canonical precision tests. |
| 33 | Floating drift controlled | PASS | Precision/undo unit test and browser integer pointer commits. |
| 34 | Drag/resize/rotate undo/redo | PASS | Parameterized service undo/redo; browser pointer undo. |
| 35 | Stale gesture refuses | PASS | Browser external edit during drag and service 409 test. |
| 36 | Failed gesture has no history | PASS | Service status after stale command; unchanged source. |
| 37 | Affine preserved/refused | PASS | Parser round trip, refusal, unchanged source/history test. |
| 38 | M1 transaction guarantees | PASS | M1 service tests and browser regression. |
| 39 | M2 typography behavior | PASS | M2 tests and browser regression. |
| 40 | Full suite | PASS | 275 passed, 1 existing skipped. |
| 41 | Typecheck | PASS | `tsc --noEmit`. |
| 42 | Browser E2E | PASS | M1, M2, and M3 Chrome flows. |
| 43 | Plain Slidev build | PASS | No-addon fixture, 457 modules. |

## Known scope and next milestone

M3 edits managed `StudioText v1` only. Multi-selection geometry is deliberately limited to same-file X/Y and translation. Arbitrary affine transforms remain visible but read-only. `max-width` is supported in source and rendering; this milestone does not add a dedicated max-width inspector control. Snapping uses the object's local frame and the peer element's measured frame, rather than a pixel-perfect rotated silhouette. Browser zoom was directly checked at three factors; the five-factor matrix is covered in pure tests.

The next milestone is M4 converter migration: emit supported `StudioText v1` with these source geometry semantics. No converter migration, advanced typography, or deck operations were implemented in M3.
