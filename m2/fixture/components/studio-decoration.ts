import type { ComputedRef, InjectionKey, VNode } from 'vue'
import { Fragment, Text, defineComponent, h } from 'vue'

export const studioDecorationKey: InjectionKey<ComputedRef<string>> = Symbol('StudioText decoration')

/** Decorate direct text nodes individually so a nested StudioRun can turn it off. */
function decorate(nodes: VNode[], line: string): VNode[] {
  if (line === 'none') return nodes
  return nodes.map((node) => {
    if (node.type === Text)
      return h('span', { style: { textDecorationLine: line } }, node.children as string)
    if (node.type === Fragment && Array.isArray(node.children))
      return h(Fragment, null, decorate(node.children as VNode[], line))
    return node
  })
}

export const DecoratedContent = defineComponent({
  name: 'StudioDecoratedContent',
  props: { decoration: { type: String, default: 'none' } },
  setup(props, { slots }) {
    return () => decorate(slots.default?.() ?? [], props.decoration)
  },
})
