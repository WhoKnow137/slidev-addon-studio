import type { ResolvedSlidevOptions } from '@slidev/types'
import type { Plugin } from 'vite'
import { join, relative } from 'node:path'
import { buildCatalog } from './catalog'
import { readPalette } from './palette'
import { assetRoot, listAssets, saveAsset } from './assets'
import { applyDeckAction } from './deck'
import { StudioTextService } from './studio-text-service'
import { buildFontCatalog } from './font-catalog'
import { TextStyleService } from './text-style-service'
import { structuralStatus } from './structural-service'
import type { StructuralAction } from './structural-service'
import { StructuralTransactionStore } from './structural-transaction'
import { refuseImagePaintMutation } from '../shared/image-paint'
import { access } from 'node:fs/promises'
import { dirname, join as pathJoin } from 'node:path'

const VIRTUAL_CATALOG = 'virtual:slidev-studio/catalog'
const RESOLVED_CATALOG = `\0${VIRTUAL_CATALOG}`
const API_PREFIX = '/@studio/'
const STUDIO_BLOCK_REQUEST = /[?&]vue&type=studio\b/

/**
 * The node half of Studio.
 *
 * It publishes the component/layout catalog as a virtual module (so palette
 * previews import the real components, lazily), and serves the small dev API
 * used for the edits Slidev's own endpoint cannot express: adding, removing,
 * reordering slides and writing assets into `public/`.
 *
 * Everything here is dev-only. In build and export mode the plugin serves an
 * empty catalog and registers no routes.
 */
export function studioPlugin(options: ResolvedSlidevOptions): Plugin {
  const studioText = new StudioTextService(options)
  const textStyles = new TextStyleService(options)

  const isDev = options.mode === 'dev' && options.data.config.editor !== false
  const config = studioConfig(options)

  // Handed to `studioMarkdownSetup`, which runs from the merged Vite config and
  // has no other way to learn what the deck asked for.
  // Off outside dev: the annotations exist so the editor can trace an element
  // back to its Markdown, and a built deck has no editor. Leaving them on put
  // `data-studio-src="0,1"` line references into published HTML.
  ;(globalThis as any).__SLIDEV_STUDIO_ANNOTATE__ = isDev ? (config.annotate ?? 'all') : 'off'

  return {
    name: 'slidev-studio',
    // Ahead of the Vue plugin, so the `<studio>` block below is claimed before
    // it is handed on as JavaScript.
    enforce: 'pre',

    resolveId(id) {
      if (id === VIRTUAL_CATALOG)
        return RESOLVED_CATALOG
      return null
    },

    async load(id) {
      // A component's metadata lives in a `<studio>` block, which keeps an SFC
      // looking like an SFC to editors. Vue emits an import for every custom
      // block it does not recognise and expects a plugin to answer it; without
      // this the YAML would reach the browser as source and fail to parse.
      if (STUDIO_BLOCK_REQUEST.test(id))
        return 'export default {}'

      if (id !== RESOLVED_CATALOG)
        return null
      if (!isDev)
        return 'export const components = []\nexport const layouts = []\nexport const palette = []\nexport const config = {}\nexport const enabled = false\n'
      return renderCatalogModule(options)
    },

    async configureServer(server) {
      if (!isDev)
        return
      const generated=pathJoin(dirname(options.data.entry.filepath),'data/slides/index.json')
      if(await access(generated).then(()=>true,()=>false))
        await new StructuralTransactionStore(dirname(options.data.entry.filepath)).recover()

      // `markdownSetup` is a single slot: a project that defines its own wins
      // over the addon's, which silently costs Studio its click-to-select.
      setTimeout(() => {
        if (!(globalThis as any).__SLIDEV_STUDIO_MARKDOWN__) {
          server.config.logger.warn(
            '[slidev-studio] Markdown source annotations are not installed. '
            + 'Your project defines `slidev.markdown.markdownSetup`, which replaces the addon\'s. '
            + 'Call `studioMarkdownSetup(md)` from it to restore click-to-select.',
          )
        }
      }, 2000)

      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0]
        if (!url?.startsWith(API_PREFIX))
          return next()

        const route = url.slice(API_PREFIX.length)
        try {
          const result = await handle(route, req.method ?? 'GET', req, options, studioText, textStyles)
          if (result === undefined)
            return next()

          // Adding, duplicating, removing or moving a slide renumbers the deck,
          // and Slidev's own reload only refreshes the slides it already knows:
          // a slide added past the end came back rendering whatever used to
          // carry that number. Rebuilding the page is the honest answer to a
          // change in the deck's shape, and it is a deliberate, occasional act.
          if ((route === 'deck' || route === 'structural' || (route === 'source-history' && (result as any)?.ownerKind === 'structural')) && req.method === 'POST') {
            setTimeout(() => server.hot.send({ type: 'full-reload' }), 150)
          }
          if (route === 'text-styles' && req.method === 'POST')
            setTimeout(() => server.hot.send({ type: 'custom', event: 'studio-text-styles-updated' }), 50)

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(result))
        }
        catch (error: any) {
          res.statusCode = Number.isInteger(error?.status) ? error.status : 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: error?.message ?? String(error) }))
        }
      })

      // Keep the palette in sync while the user is writing components.
      const componentDirs = [
        ...options.roots.map(root => join(root, 'components')),
        ...options.roots.map(root => join(root, 'layouts')),
      ]
      server.watcher.on('all', (_event, file) => {
        if (!componentDirs.some(dir => !relative(dir, file).startsWith('..')))
          return
        const mod = server.moduleGraph.getModuleById(RESOLVED_CATALOG)
        if (mod) {
          server.moduleGraph.invalidateModule(mod)
          server.hot.send({ type: 'full-reload' })
        }
      })
    },
  }
}

async function handle(route: string, method: string, req: any, options: ResolvedSlidevOptions,
  studioText: StudioTextService, textStyles: TextStyleService) {
  if (route === 'layer' && method === 'GET') {
    const q = new URL(req.url ?? '/', 'http://localhost').searchParams
    return studioText.layerStatus(Number(q.get('no')), q.get('id') ?? '', q.get('session') ?? undefined)
  }
  if (route === 'layer' && method === 'POST') return studioText.layerCommand(await readLimitedJson(req))
  if (route === 'source-history' && method === 'GET') {
    const q = new URL(req.url ?? '/', 'http://localhost').searchParams
    return studioText.historyStatus(q.get('session') ?? '')
  }
  if (route === 'source-history' && method === 'POST') return studioText.historyCommand(await readLimitedJson(req))
  if (route === 'structural' && method === 'GET') return structuralStatus(options)
  if (route === 'structural' && method === 'POST') return studioText.structuralCommand(await readLimitedJson(req))
  if (route === 'image-paint' && method === 'POST') {
    try { refuseImagePaintMutation() }
    catch(error) { throw Object.assign(error as Error,{status:422}) }
  }
  if (route === 'text' && method === 'GET') {
    const query = new URL(req.url ?? '/', 'http://localhost').searchParams
    return await studioText.status(Number(query.get('no')), query.get('id') ?? '', query.get('session') ?? undefined)
  }

  if (route === 'text' && method === 'POST')
    return await studioText.command(await readLimitedJson(req))

  if (route === 'catalog' && method === 'GET')
    return { ...await buildCatalog(options), palette: await readPalette(options) }

  if (route === 'fonts' && method === 'GET')
    return await buildFontCatalog(options)

  if (route === 'text-styles' && method === 'GET') {
    const query = new URL(req.url ?? '/', 'http://localhost').searchParams
    return await textStyles.status(query.get('session') ?? undefined)
  }
  if (route === 'text-styles' && method === 'POST')
    return await textStyles.command(await readLimitedJson(req))

  if (route === 'assets' && method === 'GET')
    return { assets: await listAssets(options), root: assetRoot(options) }

  if (route === 'assets' && method === 'POST')
    return await saveAsset(options, await readJson(req))

  if (route === 'deck' && method === 'GET') {
    const generated=pathJoin(dirname(options.data.entry.filepath),'data/slides/index.json')
    return await access(generated).then(()=>structuralStatus(options),()=>({supported:false}))
  }
  if (route === 'deck' && method === 'POST') {
    const payload=await readLimitedJson(req)
    const generated=pathJoin(dirname(options.data.entry.filepath),'data/slides/index.json')
    if (await access(generated).then(()=>true,()=>false)) {
      const state=await structuralStatus(options),slides=state.slides
      if(payload.action==='insert')throw Object.assign(Error('Managed slide insertion requires an explicit supported template'),{status:422})
      const slide=slides[payload.no-1]
      if(!slide)throw Object.assign(Error('Slide identity unavailable'),{status:422})
      let action: StructuralAction
      if(payload.action==='duplicate')action={kind:'slide',action:'duplicate',slideId:slide.id}
      else if(payload.action==='remove')action={kind:'slide',action:'delete',slideId:slide.id}
      else if(payload.action==='move') {
        const to=Math.max(1,Math.min(slides.length,Number(payload.to)))
        const without=slides.filter(s=>s.id!==slide.id)
        action={kind:'slide',action:'reorder',slideId:slide.id,beforeSlideId:without[to-1]?.id}
      }
      else throw Object.assign(Error('Unsupported managed deck action'),{status:422})
      return studioText.structuralCommand({action,session:payload.session,expectedRevision:payload.expectedRevision})
    }
    return await applyDeckAction(options,payload)
  }

  return undefined
}

async function readJson(req: any) {
  const chunks: Buffer[] = []
  for await (const chunk of req)
    chunks.push(chunk)
  const body = Buffer.concat(chunks).toString('utf-8')
  return body ? JSON.parse(body) : {}
}

async function readLimitedJson(req: any) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 262_144) throw new Error('StudioText request too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Emits the catalog as a module rather than JSON so each entry can carry a
 * real dynamic import of its component. Palette previews then render the
 * genuine component instead of a screenshot.
 */
/** Options a deck sets under `studio:` in its headmatter. */
export interface StudioConfig {
  /** How much of the rendered slide carries source annotations. */
  annotate?: 'all' | 'html' | 'off'
  /** Component names to keep out of the palette. */
  hideComponents?: string[]
}

export function studioConfig(options: ResolvedSlidevOptions): StudioConfig {
  return ((options.data.config as any).studio ?? {}) as StudioConfig
}

async function renderCatalogModule(options: ResolvedSlidevOptions) {
  const catalog = await buildCatalog(options)
  const palette = await readPalette(options)
  const config = studioConfig(options)

  const componentLoaders = catalog.components
    .filter(c => c.previewable)
    .map(c => `  ${JSON.stringify(c.name)}: () => import(${JSON.stringify(toFsUrl(c.file))}),`)
    .join('\n')

  const layoutLoaders = catalog.layouts
    .map(l => `  ${JSON.stringify(l.name)}: () => import(${JSON.stringify(toFsUrl(l.file))}),`)
    .join('\n')

  return [
    `const componentLoaders = {\n${componentLoaders}\n}`,
    `const layoutLoaders = {\n${layoutLoaders}\n}`,
    `export const components = ${JSON.stringify(catalog.components)}.map(c => ({ ...c, load: componentLoaders[c.name] }))`,
    `export const layouts = ${JSON.stringify(catalog.layouts)}.map(l => ({ ...l, load: layoutLoaders[l.name] }))`,
    `export const palette = ${JSON.stringify(palette)}`,
    `export const config = ${JSON.stringify(config)}`,
    `export const enabled = true`,
  ].join('\n\n')
}

/** Vite serves files outside the project root through the `/@fs/` prefix. */
function toFsUrl(path: string) {
  return `/@fs/${path.replace(/\\/g, '/').replace(/^\//, '')}`
}
