/** StudioText stores tagged settings as sorted JSON; CSS is render output only. */
export function cssFontSettings(source: string | undefined, kind: 'axis' | 'feature'): string | undefined {
  if (!source) return undefined
  try {
    const values: unknown = JSON.parse(source)
    if (!values || typeof values !== 'object' || Array.isArray(values)) return undefined
    const entries = Object.entries(values).sort(([a], [b]) => a.localeCompare(b))
    if (!entries.every(([tag, value]) => /^[A-Za-z0-9]{4}$/.test(tag)
      && (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)))) return undefined
    return entries.map(([tag, value]) => `"${tag}" ${typeof value === 'boolean' ? Number(value) : value}`).join(', ')
  }
  catch { return undefined }
}
