# M5 — Advanced typography acceptance report

**Status:** PASS — all 58 required M5 gates verified within the documented scope.
**Recorded:** 2026-09-25 America/Toronto (some verification timestamps are 2026-09-26 UTC).
**Scope:** M5 only. No M6 implementation.

## Revisions and package

| Artifact | Revision |
| --- | --- |
| Accepted Studio baseline | `f8e34665c689e533810b87f361dbae94857b6b93` |
| Studio implementation | `29641700fc375ab3d96bffd2d746641b88f25671` |
| Accepted converter M4 implementation | `70bbcaa5b104cc8d30e24d0779a525e244e3f00c` |
| Converter M5 implementation | `200c351cd4eae982bf971f21669c320bed67c949` |
| Studio branch | `feature/studiotext-v5` |
| Converter branch | `feature/studiotext-converter-m5` |
| Converter version | `0.5.0` |
| Portable Studio package | `0.3.1-studiotext.5.2` |

The Studio implementation spans the M5 implementation and subsequent verification fixes. Report/documentation commits follow the implementation revisions above. These are local commits; no publication or upstream push was performed.

Package evidence in converter `template/studio-contract.json`:

- Tarball SHA-256: `37cacf1f8e5f3c36941c66ca2173f48ef4dcb59600bbc9e8e8d7b24b3e251f90`.
- Typed contract source SHA-256: `8a080dc7e4383733085fd4266aa2fc894ae55d54016a772ef026921f94cf1468`.
- Bundled contract SHA-256: `8229f383b347c231f2edc9b2b12fddde88598d64d9c675c75a01dacc3278da6a`.

The generated project installs the checked local tarball. No patch of installed node_modules is required.

## Changed implementation areas

Studio:

- `shared/studiotext.ts`, `typography.ts`, `geometry.ts`: additive v1 fields, deterministic grammar, inheritance, mixed states and typed edits.
- `shared/font-catalog.ts`, `node/font-catalog.ts`, `client/font-catalog.ts`: centralized metadata discovery/cache/loading.
- `shared/text-styles.ts`, `node/text-style-service.ts`, `client/text-styles.ts`: project resource storage and guarded resource history.
- `shared/composition.ts`, `shared/text-content.ts`, `client/studiotext-editor.ts`: grapheme-safe content commands, composition buffering, preview/selection and stale-revision handling.
- `TypographyInspector.vue`, `FontPicker.vue`, `PanelInspect.vue`: advanced controls and text-edit entry.
- `StudioText.vue`, `StudioRun.vue`, `StudioParagraph.vue` and runtime helpers: plain Slidev rendering.
- Node plugin routes/HMR, README, licensed public `m5/fixture`, browser instructions/harness and regression tests.

Converter:

- Updated typed contract bundle and template runtime helpers/components.
- Dynamic package filename from pinned contract metadata, SHA verification, locked portable package and legacy migration compatibility.
- Regeneration test preserving local advanced typography; existing conservative ownership/conflict rules remain.
- `tools/stamp-studio.mjs` records commit/package/contract hashes.
- `tools/m5-regression.mjs` compares the private accepted M4 output, analyzes actual Kiwi style definitions/references, performs a reversible local edit/rerun, and writes evidence only under ignored output.

## Font resources and picker

Fontkit 2.0.4 reads real font tables under project `public/fonts` and installed Fontsource packages. Metadata includes actual family, face style/weight/stretch when available, arbitrary variable axes with bounds/defaults, and inspectable OpenType tags. The fixture demonstrates real Inter axes `opsz` and `wght`; configured custom-axis metadata is also tested.

Priority is project → explicitly configured web → detected system → unresolved requested family. Metadata/cache invalidation includes project configuration, package/lock changes and font file metadata. Face entries are deduplicated. No fabricated system inventory is shown.

Additional metadata lives in `public/studio-fonts.json`. Matching CSS font-face/loading configuration is explicit. Typing a family never creates an arbitrary internet request. Local Font Access is optional, browser-dependent and user-triggered; manual family entry remains available. Discovery/replacement never copies system font binaries.

The picker supports keyboard navigation, case-insensitive substring search, selected/mixed/missing states and candidate preview. Browser font loading is centralized and cached, with FontFaceSet loading and a bounded timeout. Missing/failed resources retain their requested family in source and expose status; browser fallback is permitted. Explicit replacement changes only the typed font property, in the selection or the current object. Multi-object/deck-wide replacement is unavailable until structural transaction support is designed.

Auto Width/Height remain source constraints. Font changes do not freeze browser-measured dimensions.

## Typed model, grammar and rendering

The contract stays **StudioText v1**.

| Property | Typed representation / source |
| --- | --- |
| Variable axes | `fontAxes: Record<string, number>` / escaped JSON `font-axes` |
| OpenType | `openType: Record<string, boolean or number>` / escaped JSON `open-type` |
| Shared object style | `styleRef` / `style-ref` |
| Paragraph spacing | `spacingBefore`, `spacingAfter` / `spacing-before`, `spacing-after` |
| Indentation | `indent`, `firstLineIndent` / `indent`, `first-line-indent` |
| List | typed `kind` and `level` / `list-kind`, `list-level` |
| Direction | `auto`, `ltr`, `rtl` / `direction` |
| Link | character/run `link` / `StudioRun link` |

Maps have sorted tags and validated finite values. Existing normalization removes redundant inherited values where applicable. Raw CSS strings are renderer output, never the editor's primary model. Unknown valid tags can round-trip; UI exposes metadata-supported controls. Invalid maps, URLs and commands fail safely.

Paragraph units are CSS/slide pixels. Lists render markers and per-level counters without modifying text strings. Levels 0–12 use 24px increments plus explicit paragraph indentation. Changing list kind preserves individual levels. The model supports ordered, bullet and none. Paragraph range edits affect every intersected paragraph; character commands affect only selected graphemes and normalize within each paragraph.

Links accept HTTP(S), mailto, anchors and project-relative paths; unsafe schemes are refused. Link add/edit/remove does not rewrite text or unrelated typography. Shared object styles cannot declare a link: links are explicitly range semantics.

RTL uses HTML `dir` and browser bidi layout. Source strings and logical TextPoint positions never reorder to match visual placement. Combining accents, flags and ZWJ emoji retain grapheme boundaries.

## Shared styles and transactions

Styles are human-readable, versioned deterministic JSON in `public/studio-text-styles.json`.

Cascade:

1. Shared character/paragraph style.
2. Explicit StudioText local defaults.
3. Paragraph properties.
4. StudioRun character overrides.
5. Caret typing style.

Effective property resolution uses the typed model. Computed DOM style is used only to verify rendering, never as source authority. The inspector reports local override count. Applying one style is one guarded object command; detach materializes effective values and removes the reference without appearance change.

Definition create/update/undo/redo use a dedicated serialized project-resource service with revision guards and atomic replacement. Object history and resource history are separate: **Undo text** and **Undo style**. This is the documented cross-file constraint permitted by M5. No browser-local style database is authoritative. Shared style deletion is deferred.

Removing shared properties recomputes inheritance from defaults instead of retaining old axes/styles.

## Preview, selection and IME

Font candidate and slider input are temporary DOM previews, with zero source/history writes. Selection is held in StudioSelection while inspector controls receive focus. A slider gesture captures object ID, source revision and selection. Release creates one command; stale revision receives 409, preview is discarded, and reload is required. Cancellation does not overwrite a renderer patch that already supplies a newer source value.

Verification fixed two browser-specific defects:

- Vue could remove contenteditable during an in-place render patch. The editor now observes attribute changes as well as child-list changes and restores editing mode.
- Enter on the font Cancel button bubbled to candidate selection. Candidate keyboard navigation is now scoped to input targets; Cancel leaves source/history unchanged.

Composition buffers intermediate candidates and writes the final Unicode text in one guarded content command. Public fixtures dispatch actual composition and beforeinput events through the production handlers. Japanese, Chinese and Korean simulations each recorded intermediate=0, final=1 and the correct caret. Empty/cancelled composition and duplicate final-event handling have unit coverage. OS IME behavior remains a manual platform test, as explicitly permitted by the milestone.

## Converter capability review and private regression

The actual private Kiwi data was inspected; automatic Figma shared-style attachment remains deferred. Aggregate findings: 37 TEXT definitions, five containing a key, 180 text-style references, 160 joined to definitions through `styleIdForText.guid`, and 20 unresolved.

Mapping candidate: definition key when present; otherwise an export-local GUID joined through the reference GUID. Property equality and local character-style indices never create identity. Before automatic mapping, compare two exports of the same document before/after a named style edit, checking key/GUID stability and local override semantics. Until then, preserve resolved object/run properties independently.

All 17 M4 fallbacks remain explicit:

| Reason | Count |
| --- | ---: |
| Visibility/partial opacity | 9 |
| Unsupported paragraph style | 4 |
| Nested unsupported container | 2 |
| Positioned/control text | 2 |

The paragraph candidates include unordered-list flags and a plain record with a first-line-of-list flag. Exact Figma indent/marker metrics and those flags' semantics are not yet established as lossless. No analyzer capability was broadened; no unsupported case was silently migrated. Existing provenance/migration/conflict guards remain, with an additional advanced-edit preservation test.

Private full conversion: 42 active slides plus ten skipped source pages; 194 managed text objects, 17 fallbacks. All 194 effective typed documents match accepted M4, including geometry/content/typography. All 52 pages' unmanaged bytes and note records match. Only one page is entirely byte-identical because M5 omits unnecessary default rotate/align/vertical-align attributes; this source minimality change is explicitly accounted for.

A real rerun preserved a local axis edit: one locally-modified-preserved, 193 unchanged, 17 unsupported, zero errors. After undoing the experiment, rerun reported 194 unchanged, 17 unsupported, zero errors. Subsequent browser font tests restored all 52 page SHA-256 hashes.

The media verifier passed all 127 assets and 2,985,555,300 stored bytes. Detailed private text, page hashes, paths, nodes and media stay under ignored converter output and are excluded from public Studio history.

## Test and browser evidence

| Check | Result |
| --- | --- |
| Studio Vitest | 299 passed; one existing opt-in upstream QA test skipped; 20 passing test files |
| Studio TypeScript | `tsc --noEmit` passed |
| Converter tests | 22 passed; zero failures/skips |
| Converter syntax checks | passed |
| Public Studio build, Slidev 52.19.0 | passed; 576 modules; final build 6.77s |
| Public plain build | passed; 467 modules; 1.39s |
| Private full Studio build, Slidev 53.0.0 | passed; 742 modules; final build 4.50s |
| Private full plain build | passed; 630 modules; 13.09s |
| Package installation | clean locked install passed; installed final version verified |
| Private regression and media hashes | passed |

Public CUA browser sequences verified:

- Font search/keyboard preview/cancel with source unchanged; explicit replacement/reload/undo/redo and missing-family restoration.
- Range-only font preview/commit leaves unselected digits unchanged; direct typed content and undo.
- Axis drag produced one source commit, preserved the other axis, survived reload, and one undo restored exact bytes.
- Real external-axis conflict: old commit refused with 409; renderer kept newer 710; fixture restored original.
- OpenType Tabular figures false survived reload as computed tnum=0.
- Style create/apply/undo; shared update on two objects; local override preserved; appearance-identical detach and undo.
- Three-paragraph partial-range color/size/underline, reload and undo/redo; alignment applies to all intersected paragraphs.
- Bullet → nested-level change → numbered preserved levels 0/2/0, runtime counters/indentation and logical text; undo restored bytes.
- Link remove/add, independent weight, reload, URL edit/removal and undo/redo preserved text and frac.
- RTL and mixed bidi formatting/reload preserved logical strings and graphemes.
- Japanese/Chinese/Korean composition-event fixtures produced one final command.
- Enter on Cancel regression preserved missing-family source and created no extra undo entry.

The exported `m5/e2e.cua.mjs` harness is prepared for repeatability; the recorded run executed the documented CUA operations directly with filesystem checks. Do not interpret it as a separate standalone harness execution. The public event fixture exercises production editor code and is excluded from the package and plain production runtime.

Large private deck: opened Studio, selected converted text, searched fonts, changed and undid the font, then used a public-only extra regression slide for axis and shared-style checks with the final package. Both shared objects changed to 58px while the red override remained; undo restored the style file. No obvious typography interaction stalls were observed. Catalog HTTP responses measured 219.14ms then 6.7994ms (2774 bytes, both 200). These are environment-specific observations, not a performance SLA.

## Known limitations and remaining experiments

- Automatic Figma shared-style identity linking and exact unsupported paragraph conversion require the controlled evidence described above.
- Multi-object/deck-wide replacement, style deletion and deck operations are deferred.
- OS IME testing remains manual; deterministic composition-event tests are the automated evidence.
- New paragraph creation through ordinary Enter is not implemented here; existing multi-paragraph editing/formatting and soft breaks are supported.
- Web font loading needs explicit project CSS; system discovery depends on browser permissions/capabilities. Supported OpenType metadata is not a guarantee of glyph coverage for every language.
- The full project's npm audit reports 13 advisories (2 low, 1 moderate, 10 high). This milestone did not force unrelated major dependency upgrades.
- Simultaneous build output writes and a dev watcher caused one Windows EBUSY in a copied MP4. The build succeeded; restarting after the build recovered the dev server. Run builds and interactive regression sequentially. General watcher hardening is outside M5.
- Auto component discovery emits duplicate-component warnings where fixture/generated runtime copies coexist with the addon. All required builds still succeeded.

## M5 acceptance table

PASS applies to the scoped implementations and explicit permitted deferrals above.

| # | Required gate | Status | Evidence |
| ---: | --- | --- | --- |
| 1 | Font catalog exists | PASS | Centralized node/client catalog |
| 2 | Project fonts indexed | PASS | Fontkit real-table tests and private picker |
| 3 | Configured web fonts supported | PASS | Explicit metadata/configuration test; CSS loading documented |
| 4 | System limits explicit | PASS | Optional Local Font Access and manual entry |
| 5 | Searchable picker | PASS | Case-insensitive substring and keyboard browser checks |
| 6 | Preview no source/history write | PASS | Byte checks; corrected keyboard Cancel |
| 7 | Font selection commits once | PASS | Source/reload and single-command undo |
| 8 | Missing state visible | PASS | Public unavailable-family fixture |
| 9 | Missing requested family preserved | PASS | Source before replacement and after undo |
| 10 | Explicit replacement | PASS | Object/range browser sequences; broader scopes deferred |
| 11 | Metadata-aware faces | PASS | Actual deduplicated weight/style entries |
| 12 | Dynamic variable axes | PASS | Font tables and configured custom-axis test |
| 13 | Axis UI | PASS | Slider drag and large-project axis edit |
| 14 | Axis round-trip | PASS | Typed parser/serializer and reload |
| 15 | Axis mixed state | PASS | Per-tag effective mixed-value test |
| 16 | OpenType discovery | PASS | Real feature table metadata |
| 17 | OpenType controls | PASS | Tabular figures browser toggle |
| 18 | OpenType round-trip | PASS | Typed maps and reload tnum=0 |
| 19 | Shared storage | PASS | Versioned project JSON |
| 20 | Styles apply | PASS | Browser create/apply and service tests |
| 21 | Style inheritance | PASS | Typed cascade and inheritance-reset tests |
| 22 | Overrides survive | PASS | Two-object shared update keeps red override |
| 23 | Detach appearance | PASS | Browser comparison and service tests |
| 24 | Style undo | PASS | Dedicated resource and object histories |
| 25 | Paragraph spacing | PASS | Typed tests; browser persistence and undo |
| 26 | Paragraph indentation | PASS | Explicit and first-line typed fields/tests |
| 27 | Bullets | PASS | Browser list sequence |
| 28 | Numbered lists | PASS | Reload counters and deterministic source |
| 29 | List indentation | PASS | Levels preserved 0/2/0 |
| 30 | Links | PASS | Add/edit/remove/reload/undo browser sequence |
| 31 | Independent link typography | PASS | Weight and frac preserved through URL edits |
| 32 | Multi-paragraph characters | PASS | Middle P1 through middle P3 browser sequence |
| 33 | Multi-paragraph paragraphs | PASS | Alignment/list/spacing intersected-paragraph semantics |
| 34 | Mixed paragraph states | PASS | Typed effective property-resolution tests |
| 35 | RTL | PASS | dir=rtl runtime and reload |
| 36 | Bidi logical order | PASS | Arabic/Hebrew mixed content remains logical |
| 37 | Grapheme safety | PASS | Combining/flag/ZWJ tests and fixture |
| 38 | IME one logical commit | PASS | Three composition-event simulations |
| 39 | Controls preserve selection | PASS | Partial range and multi-paragraph browser checks |
| 40 | Preview history clean | PASS | Byte-identical cancel; one-undo axis gesture |
| 41 | Unsupported fonts/features safe | PASS | Missing/failed state; map/URL/metadata validation |
| 42 | Source minimal | PASS | One-font exact diff and per-axis/per-paragraph tests |
| 43 | Source deterministic | PASS | Sorted maps/resource JSON; no-op tests |
| 44 | Plain build | PASS | Public and full private plain builds |
| 45 | Studio build | PASS | Public and full private Studio builds |
| 46 | M1 regression | PASS | Partial ranges, selection and guarded-service suite |
| 47 | M2 regression | PASS | Typography unit/service suite and browser |
| 48 | M3 regression | PASS | Geometry/service suites and unchanged private models |
| 49 | M4 integration | PASS | Final portable package; 194 equivalent objects |
| 50 | Rerun preserves Studio edits | PASS | Real local-axis edit kept byte-for-byte |
| 51 | Fallback migration only when safe | PASS | Evaluation completed; no unproven migration enabled |
| 52 | Unsupported explicit | PASS | All 17 reasons retained |
| 53 | Public fixture privacy | PASS | Synthetic texts and licensed fonts only |
| 54 | Studio suite | PASS | 299 passed; upstream optional QA skip documented |
| 55 | Converter suite | PASS | 22 passed |
| 56 | Typecheck | PASS | tsc exit 0 |
| 57 | Browser E2E | PASS | Recorded CUA sequences and production event fixture |
| 58 | No M6 work | PASS | No deck-operation or general non-text changes |

**M5 complete. Ready for M6 — Deck operations and hardening.**

