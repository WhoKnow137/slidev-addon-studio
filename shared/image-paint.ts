/** Evidence inspection only. No private image mode, matrix direction or paint ID is inferred. */
export interface PaintResource {
  sourceHash: string | null
  sha256: string | null
  url: string | null
  member: string | null
}
export interface ImagePaintEvidence {
  version: 1
  scope: 'private-kiwi' | 'synthetic'
  sourceNodeId: string
  orderedPaints: Record<string, unknown>[]
  layer: Record<string, unknown>
  placements: { sourcePath: string | null, resource: PaintResource, poster: PaintResource | null,
    thumbnail: PaintResource | null, rendererProjection: unknown }[]
}
export interface ImagePaintInspection {
  ownerLayerId: string
  ownership: 'single-image-paint' | 'ambiguous-paint-stack' | 'no-image-paint'
  persistentPaintId: null
  mode: 'unknown'
  matrixDirection: 'unknown'
  coordinateSpace: 'unknown'
  writable: false
  blockers: string[]
  images: { sourcePath: string, rawMode: unknown, rawMatrix: unknown,
    intrinsicWidth: unknown, intrinsicHeight: unknown, paintOpacity: unknown, visible: unknown }[]
  evidence: ImagePaintEvidence
}
export const IMAGE_MUTATION_BLOCKERS = ['I-F01/B-F02: crop input and apply boundary',
  'I-F02: private modes, matrix spaces and resize', 'I-F03: replacement identity/aspect',
  'I-F04: corners/clamping', 'I-F05: opacity/effect compositing'] as const

export function inspectImagePaint(encoded: string, ownerLayerId: string): ImagePaintInspection {
  if(encoded.length>1_000_000)throw Error('Image paint evidence exceeds inspection limit')
  const value=JSON.parse(encoded) as ImagePaintEvidence
  if(!value||value.version!==1||!['private-kiwi','synthetic'].includes(value.scope)||
    typeof value.sourceNodeId!=='string'||!Array.isArray(value.orderedPaints)||
    value.orderedPaints.some(p=>!p||typeof p!=='object'||Array.isArray(p))||
    !value.layer||typeof value.layer!=='object'||Array.isArray(value.layer)||!Array.isArray(value.placements))
    throw Error('Invalid image paint evidence')
  const images=value.orderedPaints.flatMap((p,i)=>p.type==='IMAGE'||p.type==='VIDEO'?[{
    sourcePath:`fillPaints[${i}]`,rawMode:p.imageScaleMode??null,rawMatrix:p.transform??null,
    intrinsicWidth:p.originalImageWidth??null,intrinsicHeight:p.originalImageHeight??null,
    paintOpacity:p.opacity??null,visible:p.visible??null,
  }]:[])
  // This is an ownership capability, not a native identity or a reconciled paint ID.
  const ownership=images.length===0?'no-image-paint':value.orderedPaints.length===1&&images.length===1
    ?'single-image-paint':'ambiguous-paint-stack'
  return {ownerLayerId,ownership,persistentPaintId:null,mode:'unknown',matrixDirection:'unknown',
    coordinateSpace:'unknown',writable:false,blockers:[...IMAGE_MUTATION_BLOCKERS],images,evidence:value}
}

export function refuseImagePaintMutation(): never {
  throw Error('Image paint mutation BLOCKED: native I-F01–I-F05/B-F02 evidence is unresolved')
}
