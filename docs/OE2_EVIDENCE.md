# OE0B/OE2 evidence-limited image inspection

OE2 editing is BLOCKED on native I-F01–I-F05 and B-F02. This branch continues
from proven M6 without assigning private STRETCH to Crop or guessing matrix
direction, mode reset, replacement aspect compensation, corners or effects.

`StudioLayer` optionally carries a literal JSON `paint-evidence` attribute.
It is preservation/inspection metadata within the authoritative Markdown span,
not another editable scene database or renderer input. Older layers remain
supported. The plain renderer and its slot are unchanged. A typed inspection
separates owner, ordered raw paints, main/poster/thumbnail resources, private
mode/matrix/intrinsics, layer appearance and the existing renderer projection.
Unknown fields and missing fields remain distinct. SHA-256 identifies stored
resource bytes; it is not paint identity.

No native persistent paint ID is frozen. Only an unambiguous entire stack of
one image/video paint is classified as single-paint ownership; hidden paints
and overlays make the stack ambiguous. This classification remains read-only.
The current wrapper ID supplies the inspection owner, so M6 cloning/movement
does not clone a permanent paint identity. Paint array offsets are displayed
solely as source addresses for this parse.

Selecting a fresh converted image shows read-only paint evidence. Interpreted
mode, matrix direction and coordinate space are explicitly unknown, even for
private FILL. A renderer cover/contain projection does not promote a native
mode. POST `/@studio/image-paint` refuses with 422 before parsing resources,
writing source or adding history. There is no crop interaction state, paint
preview, replacement or appearance mutation UI. Existing geometry and M6
controls retain their accepted scope and shared source history.

The converter's full-subtree ownership fingerprint covers the evidence and
render slot. Manual changes are preserved; simultaneous source changes are
conflicts, not matrix merges. Existing outputs are not silently promoted.
Separate paint-domain mutation/reconciliation still requires native evidence.

Public tests: `test/image-paint.test.ts`. Adjacent converter tests and
`tools/prepare-oe2-evidence-fixture.mjs` provide synthetic candidates for mode,
rotation, corners, opacity, overlay/shared resource and changed-aspect cases.
These are inspection tests, never native goldens or editing acceptance passes.
