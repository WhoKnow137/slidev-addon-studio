# Managed layer geometry — OE0A

The `0.3.1-oe0a.4` fork adds managed non-text geometry alongside StudioText. No second mutable scene database is used. Saved Markdown is authoritative in Studio and plain Slidev.

## Source contract

```vue
<StudioLayer version="1" id="layer-public-image" slide-id="public-slide"
  source-id="synthetic:image" source-type="RECTANGLE" kind="image"
  pos="160,180,360,220" rotate="0" capability="FULL" rotation="true"
  reason="Layer frame only; immutable paint">
  <!-- Existing converter-rendered image/appearance source belongs here. -->
</StudioLayer>
```

Identity is independent of position, size, rotation, name and DOM order. The converter derives it from the slide GUID and complete source node address, including instance path context. Ambiguous identities refuse ownership. Their explicit render-only marker selects an inspection-only owner and blocks generic geometry/structural routes without inventing a managed ID. Root wrappers are owned spans; nested imported child geometry remains parent-local and resolves to the root owner.

`pos` uses the accepted M3 unrotated frame in slide/parent-local coordinates; rotation is about its center. Resize edits the frame. It does not change paint transforms, resource bytes or path data. This milestone has no Scale tool.

| Capability | Editing |
| --- | --- |
| FULL | X/Y, W/H, rotation when declared safe |
| POSITION_ONLY | X/Y and safe rotation; W/H disabled |
| READ_ONLY | Inspection with a reason; no geometry writes |
| UNAVAILABLE | No mutation |

The converter currently grants FULL to safe leaf media frames and POSITION_ONLY to safe shape/vector/frame/instance roots. Affine/sheared/reflected transforms remain read-only. Frame constraints and instance child overrides are deferred.

## Interaction

Open Studio in Slidev development mode. Click a layer to select its explicit `data-studio-object-id` owner. Click text to return to StudioText; double-click it to enter text editing. Video authoring clicks select without invoking presentation playback handlers. Empty canvas and Escape clear selection.

Shift-click toggles managed layer selection. Dragging multiple layers translates them in one all-or-none transaction. Typed X/Y assigns the same absolute parent-local coordinate to each selected layer. Mixed values are displayed as Mixed. Multi-resize, multi-rotate and mixed text/layer manipulation are unavailable. Nested Ctrl/Cmd-click conservatively resolves to the known root owner.

Arrow keys nudge a layer by 1 slide unit; Shift+Arrow by 10. Text caret arrows continue navigating text. Snapping uses the existing Studio engine and screen-consistent tolerance; Alt bypasses it. This is Studio policy, not a claim of complete Figma gesture parity.

## Persistence and history

Pointer movement changes a temporary DOM preview only. Pointer release issues one typed command with the revision captured at gesture start. Numeric controls capture the revision on focus. Vue AST spans identify exact literal geometry attributes. The existing source service validates, rechecks, atomically writes and records history. Appearance slot bytes and unrelated Markdown are preserved.

Text and layer source commands share one session chronology. Undo/redo resolves the actual latest owner, including another imported source page. Exact file revisions guard undo/redo too. Browser reload retains the session and server history; restarting the dev server clears its in-memory history. Saved geometry remains in source across restarts. Resource/shared-text-style history retains its existing explicit scope.

Manual source edits cause revision refresh and owner resolution. A stale gesture or numeric edit refuses instead of overwriting the new source. Generic property, geometry and structural routes cannot write managed objects. The explicit Slidev source editor remains available.

## Converter ownership

The converter's `data/layer-provenance.json` records source identity, exact owned subtree fingerprints and layer-only geometry ownership. An unchanged local subtree regenerates safely. A local edit is preserved; simultaneous source changes report a conflict. Local deletion and source removal are reported conservatively. Older component syntax still renders, and old outputs without layer provenance are not silently promoted.

Paint identity, generated subpart identity, crop mapping, replacement, paint/path/corner/effect editing, playback property editing, constraints, overrides, reorder, duplicate/delete, and M6 remain deferred.

Public tests: `test/managed-layer.test.ts` and `test/layer-gesture.test.ts`. The adjacent converter repository contains `test/fixtures/oe0a/slides.md` and `tools/prepare-oe0a-fixture.mjs` for generating synthetic assets. No private presentation material belongs in this repository.
