import { buildSettingPath } from '../../shared/settings'

/**
 * Persisted Hidden Controls contract. Only this shape is stored; derived
 * runtime status is never persisted. See the chat-controls plan data shapes.
 */
export type ControlKind = 'control' | 'single-control-host'

export interface ControlTargetDescriptor {
  readonly ownerIdentifier: string
  readonly mount: string
  readonly kind: ControlKind
  readonly semanticAttribute: string
  readonly semanticValue?: string
}

export interface ChatControlRule {
  readonly id: string
  readonly enabled: boolean
  readonly label: string
  readonly target: ControlTargetDescriptor
}

export interface ChatControlRulesPayload {
  readonly schemaVersion: 1
  readonly rules: readonly ChatControlRule[]
}

/** Computed, never persisted. `paused` = disabled or matched but unverified. */
export type DerivedStatus = 'hidden' | 'paused' | 'not-found'

export const CHAT_CONTROLS_RULES_KEY = buildSettingPath('chat_controls', 'rules')
export const CHAT_CONTROLS_RULES_VERSION = 1 as const

const ADMITTED_MOUNTS = new Set([
  'chat_header_left',
  'chat_header_center',
  'chat_header_right',
  'chat_top_dock',
  'chat_bottom_dock',
])

/** Stable semantic identities; arbitrary selectors/CSS classes are rejected. */
const SEMANTIC_ATTRIBUTES = new Set([
  'data-prism-toolbar-button',
  'data-vn-header-launcher',
  'data-toolbar-action',
  'aria-label',
  'title',
])

/** Presence-only identity: carrying a value would be ambiguous. */
const VALUELESS_ATTRIBUTES = new Set(['data-prism-toolbar-button', 'data-vn-header-launcher'])

/** Canonical/shared owners are never valid targets. */
const RESERVED_OWNERS = new Set(['lumiverse_suite', 'lumiverse', 'quick_toolbar'])

const OWNER_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.:/-]{0,63}$/
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
/** Prototype keys can poison keyed status containers; reject as rule identity. */
const RESERVED_RULE_IDS = new Set(['__proto__', 'constructor', 'prototype'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validOwner(value: unknown): value is string {
  return typeof value === 'string' && OWNER_PATTERN.test(value) && !RESERVED_OWNERS.has(value)
}

function validMount(value: unknown): value is string {
  return typeof value === 'string' && ADMITTED_MOUNTS.has(value)
}

function validSemanticAttribute(value: unknown): value is string {
  return typeof value === 'string' && SEMANTIC_ATTRIBUTES.has(value)
}

function validSemanticValue(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > 64 || value !== value.trim()) return false
  if (!VALUE_PATTERN.test(value)) return false
  if (UUID_PATTERN.test(value)) return false
  if (/^\d+$/.test(value)) return false
  return true
}

/**
 * Validate one descriptor. Rejects arbitrary selectors/CSS classes, transient
 * or UUID/chat identity values, and malformed attribute/value paths.
 */
export function normalizeControlTargetDescriptor(raw: unknown): ControlTargetDescriptor | undefined {
  if (!isRecord(raw)) return undefined
  if (!validOwner(raw.ownerIdentifier)) return undefined
  if (!validMount(raw.mount)) return undefined
  if (raw.kind !== 'control' && raw.kind !== 'single-control-host') return undefined
  if (!validSemanticAttribute(raw.semanticAttribute)) return undefined
  const semanticAttribute = raw.semanticAttribute
  if (VALUELESS_ATTRIBUTES.has(semanticAttribute)) {
    if (raw.semanticValue !== undefined) return undefined
    return { ownerIdentifier: raw.ownerIdentifier, mount: raw.mount, kind: raw.kind, semanticAttribute }
  }
  if (!validSemanticValue(raw.semanticValue)) return undefined
  return { ownerIdentifier: raw.ownerIdentifier, mount: raw.mount, kind: raw.kind, semanticAttribute, semanticValue: raw.semanticValue }
}

export function normalizeChatControlRule(raw: unknown): ChatControlRule | undefined {
  if (!isRecord(raw)) return undefined
  const { id, enabled, label } = raw
  if (typeof id !== 'string' || id.length === 0 || id.length > 128 || id !== id.trim()
    || CONTROL_CHARS.test(id) || RESERVED_RULE_IDS.has(id)) return undefined
  if (typeof enabled !== 'boolean') return undefined
  if (typeof label !== 'string' || label.length === 0 || label.length > 200 || label !== label.trim() || CONTROL_CHARS.test(label)) return undefined
  const target = normalizeControlTargetDescriptor(raw.target)
  if (!target) return undefined
  return { id, enabled, label, target }
}

/** Stable identity for a descriptor; used to reject ambiguous duplicates. */
export function chatControlTargetSignature(target: ControlTargetDescriptor): string {
  return [target.ownerIdentifier, target.mount, target.kind, target.semanticAttribute, target.semanticValue ?? ''].join('\u0000')
}

/**
 * Consolidated parser: drops malformed entries individually, preserves valid
 * ones, and rejects duplicate ids / ambiguous duplicate target descriptors.
 */
export function normalizeChatControlRules(raw: unknown): ChatControlRulesPayload {
  const empty: ChatControlRulesPayload = { schemaVersion: CHAT_CONTROLS_RULES_VERSION, rules: [] }
  if (!isRecord(raw) || !Array.isArray(raw.rules)) return empty
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== CHAT_CONTROLS_RULES_VERSION) return empty

  const candidates: ChatControlRule[] = []
  const groups = new Map<string, ChatControlRule[]>()
  const order: string[] = []
  for (const entry of raw.rules) {
    const rule = normalizeChatControlRule(entry)
    if (!rule) continue
    let group = groups.get(rule.id)
    if (!group) { group = []; groups.set(rule.id, group); order.push(rule.id) }
    group.push(rule)
  }

  // A conflicting duplicate-ID group fails safe as a whole; identical duplicates collapse.
  for (const id of order) {
    const group = groups.get(id)!
    const first = group[0]!
    const identical = group.every(rule => rule.enabled === first.enabled && rule.label === first.label
      && chatControlTargetSignature(rule.target) === chatControlTargetSignature(first.target))
    if (group.length > 1 && !identical) continue
    candidates.push(first)
  }

  const signatureCounts = new Map<string, number>()
  for (const rule of candidates) {
    const signature = chatControlTargetSignature(rule.target)
    signatureCounts.set(signature, (signatureCounts.get(signature) ?? 0) + 1)
  }

  const rules = candidates.filter(rule => (signatureCounts.get(chatControlTargetSignature(rule.target)) ?? 0) === 1)
  return { schemaVersion: CHAT_CONTROLS_RULES_VERSION, rules }
}

/** Build a fresh payload without retaining caller references. */
export function toChatControlRulesPayload(rules: readonly ChatControlRule[]): ChatControlRulesPayload {
  return {
    schemaVersion: CHAT_CONTROLS_RULES_VERSION,
    rules: rules.map(rule => ({
      id: rule.id,
      enabled: rule.enabled,
      label: rule.label,
      target: { ...rule.target },
    })),
  }
}
