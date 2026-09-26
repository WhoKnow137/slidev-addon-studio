import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { buildFontCatalog } from '../node/font-catalog'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

describe('M5 project font catalog', () => {
  it('supports explicit web metadata, rejects invalid controls, and keeps web priority above system', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studio-font-config-'))
    try {
      await mkdir(join(root, 'public'))
      await writeFile(join(root, 'public/studio-fonts.json'), JSON.stringify({ version: 1, fonts: [
        { family: 'Configured Web', source: 'web', styles: [{ weight: 400, style: 'normal' }], variableAxes: [{ tag: 'CSTM', name: 'Custom', min: 0, default: 0.5, max: 1 }], openTypeFeatures: [{ tag: 'ss01', name: 'Set one' }] },
        { family: 'Configured Web', source: 'system' },
        { family: 'Invalid Controls', source: 'web', styles: [{ weight: -5, style: 'fake' }], variableAxes: [{ tag: 'bad', min: 0, default: 99, max: 1 }] },
      ] }))
      const first = await buildFontCatalog({ userRoot: root })
      expect(first.fonts.find(f => f.family === 'Configured Web')).toMatchObject({ source: 'web', variableAxes: [{ tag: 'CSTM' }], openTypeFeatures: [{ tag: 'ss01' }] })
      expect(first.fonts.find(f => f.family === 'Invalid Controls')).toMatchObject({ styles: [], variableAxes: [] })
      expect(await buildFontCatalog({ userRoot: root })).toBe(first)
    }
    finally { await rm(root, { recursive: true, force: true }) }
  })
  it('reads family, axes and OpenType tags from licensed fixture font tables', async () => {
    const catalog = await buildFontCatalog({ userRoot: join(process.cwd(), 'm5', 'fixture') })
    const inter = catalog.fonts.find(item => item.family === 'Inter')
    const nanum = catalog.fonts.find(item => item.family === 'NanumMyeongjo')
    expect(inter?.source).toBe('project')
    expect(inter?.variableAxes.map(axis => axis.tag)).toEqual(['opsz', 'wght'])
    expect(inter?.openTypeFeatures.map(feature => feature.tag)).toContain('tnum')
    expect(nanum?.source).toBe('project')
    expect(nanum?.variableAxes).toEqual([])
    expect(nanum?.metadataSource).toContain('font tables:')
  })
})
