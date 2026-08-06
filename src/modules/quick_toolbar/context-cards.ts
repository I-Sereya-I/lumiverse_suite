export type ContextCardKind = 'character' | 'persona' | 'connection' | 'lore' | 'reasoning' | 'composition' | 'loom'

export interface ContextCardValue {
  readonly kind: ContextCardKind
  readonly label: string
  readonly value: string
  readonly actionId?: string
}

export interface ContextCardSelectorPort {
  get(kind: ContextCardKind): ContextCardValue
  subscribe?(kind: ContextCardKind, listener: (value: ContextCardValue) => void): () => void
}

export interface ContextCardStripOptions {
  readonly mount: HTMLElement
  readonly selectors: ContextCardSelectorPort
  readonly document?: Document
  readonly onInvoke?: (value: ContextCardValue) => void
}

export interface ContextCardStripController {
  readonly element: HTMLElement
  update(value: ContextCardValue): void
  destroy(): void
}

const MODULE = 'quick_toolbar'
const CARD_KINDS: readonly ContextCardKind[] = ['character', 'persona', 'connection', 'lore', 'reasoning', 'composition', 'loom']

function own<T extends HTMLElement>(element: T): T {
  element.setAttribute('data-lumiverse-module', MODULE)
  return element
}

export function createContextCardStrip(options: ContextCardStripOptions): ContextCardStripController {
  const doc = options.document ?? document
  const strip = own(doc.createElement('section'))
  strip.className = 'lumiverse-quick-toolbar__context-strip'
  strip.setAttribute('aria-label', 'Chat context')
  strip.dataset.dockRequest = 'strip'
  const cards = new Map<ContextCardKind, HTMLButtonElement>()
  const values = new Map<ContextCardKind, ContextCardValue>()
  const disposers: Array<() => void> = []

  const render = (value: ContextCardValue) => {
    values.set(value.kind, value)
    const card = cards.get(value.kind) ?? (() => {
      const next = own(doc.createElement('button'))
      next.type = 'button'
      next.className = 'lumiverse-quick-toolbar__context-card'
      next.dataset.contextKind = value.kind
      next.addEventListener('click', () => {
        const latest = values.get(value.kind)
        if (latest) options.onInvoke?.(latest)
      })
      cards.set(value.kind, next)
      strip.append(next)
      return next
    })()
    card.setAttribute('aria-label', `${value.label}: ${value.value}`)
    card.replaceChildren()
    const label = own(doc.createElement('span'))
    label.className = 'lumiverse-quick-toolbar__context-label'
    label.textContent = value.label
    const content = own(doc.createElement('strong'))
    content.className = 'lumiverse-quick-toolbar__context-value'
    content.textContent = value.value
    card.append(label, content)
  }
  for (const kind of CARD_KINDS) {
    render(options.selectors.get(kind))
    if (options.selectors.subscribe) disposers.push(options.selectors.subscribe(kind, render))
  }
  options.mount.append(strip)
  return {
    element: strip,
    update: render,
    destroy() { for (const dispose of disposers.splice(0).reverse()) dispose(); strip.remove() },
  }
}
