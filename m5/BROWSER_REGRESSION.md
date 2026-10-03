# M5 browser regression

Start the public fixture with `slidev m5/fixture/slides.md --port 3316`. Open `/2`, enable Studio, and use one browser tab to avoid Slidev navigation synchronization between test tabs.

`e2e.cua.mjs` supplies a reusable regression function for a CUA tab plus fixture-file readers. It automates missing-font status, case-insensitive search, preview cancellation, and three composition-event sequences with exact byte restoration by undo. `offsetY` is an explicit test-environment parameter: the IAB used for this run required a measured 48px input-coordinate correction; production editor code has no such adjustment. Normal browser environments should use zero. This exported harness was added for repeatability; the recorded session used the same documented CUA operations directly, with filesystem checks between source-changing actions.

The fixture's composition buttons dispatch real `compositionstart`, multiple `compositionupdate` / `beforeinput` events, and `compositionend`. A temporary fetch observer counts only content transactions, captures the resulting typed document/caret, and restores the original fetch function. It is excluded from the packaged addon. Expected browser output:

```
PASS Japanese: intermediate=0; final=1; caret=3; Unicode=true
PASS Chinese: intermediate=0; final=1; caret=2; Unicode=true
PASS Korean: intermediate=0; final=1; caret=3; Unicode=true
```

The range buttons select real DOM text endpoints; the editor must map them back to `StudioSelection`. They deliberately avoid writing editor state. Use **Edit text** before the range buttons. **Select three paragraphs** chooses the middle of paragraph one through `Linked` in paragraph three; **Select RTL paragraph** chooses the second paragraph; **Select linked range** chooses the linked text.

Additional acceptance sequences:

1. Missing font → explicit NanumMyeongjo replacement → reload → undo → redo → undo. Inspect source: only `font-family` changes. Range preview/commit on `Variable` leaves digits in Inter.
2. Variable object → Weight axis drag → one commit → reload → inspect computed `fontVariationSettings` → undo/redo. Changing one axis preserves `opsz`. Select Variable text and wait for font metadata, then use **Test axis revision conflict**: a real slider input previews 740, a separate guarded session commits 710, and the old slider change receives 409. The fixture verifies the renderer retains 710 and undoes its external edit. Recorded output: `PASS axis conflict: refused=true; authoritative="opsz" 24, "wght" 710; restored=true`.
3. Turn off Tabular figures → reload → computed `fontFeatureSettings` contains `"tnum" 0` → undo.
4. Shared hero style size 52 → 58 → both objects update; second object's red override survives. Detach the second → effective appearance is unchanged → undo. The browser also created **Heading / Browser**, applied it to hero-a, and undid both the object attachment and resource creation to exact original bytes. Guarded two-object service tests cover create/apply/update/detach history.
5. Select three paragraphs → color `#00ff55`, size 31, underline → reload. Only Arabic/remaining text in paragraph one, all paragraph two, and `Linked` in paragraph three change. Alignment center affects all three paragraph records. Undo/redo preserves boundaries and original strings.
6. Select three paragraphs → bullets. Select RTL paragraph → increase its list level. Select three paragraphs → numbered. Reload; all kinds change and individual levels survive. Undo each operation.
7. Select linked range → change URL → change typography independently → reload → remove link → undo/redo. Text/graphemes and feature overrides remain unchanged.
8. Select RTL paragraph → character formatting → reload; `dir="rtl"` persists and source strings stay in logical order. Combining accent, flag and ZWJ emoji remain whole graphemes.

Keep test evidence public and synthetic. Private Equinox timings and source checks belong only in the converter's ignored output directory.

The keyboard-cancel regression focuses Font family, searches `nAnUm`, then activates **Cancel** with Enter. Missing requested family and source remain unchanged. This caught and fixed a bubbling Enter handler that previously also selected the highlighted candidate. The final package contains the correction.

The complete link sequence was executed: remove original link, add `https://example.org/new`, set weight 700, reload (text `Linked 1/2`, weight 700, feature `frac`, and URL persisted), edit URL, remove, undo/redo, then undo all commands. Source returned byte-for-byte to the committed fixture.
