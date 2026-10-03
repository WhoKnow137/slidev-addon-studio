import { it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ResolvedSlidevOptions } from '@slidev/types'
import { managedLayerSpans, parseManagedLayer } from '../shared/managed-layer'
import { StudioTextService } from '../node/studio-text-service'
import { digest } from '../node/structural-transaction'

const source=process.env.M6_PRIVATE_PROJECT
const deck=process.env.M6_PRIVATE_DECK
const hashFile=async(path:string)=>{const h=createHash('sha256');for await(const part of createReadStream(path))h.update(part);return h.digest('hex')}
it.skipIf(!source)('private accepted-output stability and safe structural undo',async()=>{
  const project=source!,report=JSON.parse(await readFile(join(project,'conversion-report.json'),'utf8'))
  expect([report.slides.active,report.slides.skipped,report.text.studioText,report.text.unsupported,report.layers.count,
    report.layers.byKind.shape,report.appearance.counts['rendered-corner-radius']]).toEqual([42,10,194,17,103,12,3])
  const assets=JSON.parse(await readFile(join(project,'data/assets.json'),'utf8'))
  expect(assets).toHaveLength(127)
  for(const a of assets)expect(await hashFile(join(project,'public',a.url))).toBe(a.sha256)
  if(deck)expect(await hashFile(deck)).toBe(report.source.sha256)

  const root=await mkdtemp(join(tmpdir(),'m6-private-copy-'))
  try{
    const rows=JSON.parse(await readFile(join(project,'data/slides/index.json'),'utf8'))
    const paths=['slides.md','data/slides/index.json','data/layer-provenance.json','data/conversion-provenance.json',...rows.map((r:{page:string})=>r.page)]
    for(const rel of paths){const target=join(root,rel);await mkdir(dirname(target),{recursive:true});await cp(join(project,rel),target)}
    const before=new Map<string,string>();for(const rel of paths)before.set(rel,digest(await readFile(join(root,rel))))
    let selected:{slideId:string,page:string,id:string}|null=null
    for(const row of rows.filter((r:{skipped:boolean})=>!r.skipped)){
      const source=await readFile(join(root,row.page),'utf8')
      const hit=managedLayerSpans(source).find(s=>{const m=parseManagedLayer(s.source);return m.kind!=='instance'&&m.capabilities.level!=='READ_ONLY'})
      if(hit){selected={slideId:row.id,page:row.page,id:hit.id};break}
    }
    expect(selected).toBeTruthy()
    const item=selected!,file=join(root,item.page),first=digest(await readFile(file))
    const options={data:{entry:{filepath:join(root,'slides.md')},slides:[{source:{filepath:file,index:0}}]}} as unknown as ResolvedSlidevOptions
    const service=new StudioTextService(options),session='m6-private-session'
    const result=await service.structuralCommand({action:{kind:'object',action:'duplicate',slideId:item.slideId,id:item.id},session,expectedRevision:first})
    await service.historyCommand({action:'undo',no:1,session,expectedRevision:result.revision})
    for(const rel of paths)expect(digest(await readFile(join(root,rel)))).toBe(before.get(rel))
    for(const rel of ['data/structural-provenance.json','data/resource-reachability.json'])
      await expect(readFile(join(root,rel))).rejects.toMatchObject({code:'ENOENT'})
  }finally{await rm(root,{recursive:true,force:true})}
},180_000)
