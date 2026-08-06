export const CONNECTIONS_PICKER_VARIANTS = ['A', 'B', 'C'] as const

export type ConnectionsPickerVariant = (typeof CONNECTIONS_PICKER_VARIANTS)[number]

export interface ConnectionsPickerRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ConnectionPickerTag {
  id: string
  name: string
  color: string
  order: number
}

/** Deliberately redacted profile projection consumed by the extension UI. */
export interface ConnectionPickerProfile {
  id: string
  name: string
  provider: string
  model: string
  tagIds?: readonly string[]
  isModelRoulette?: boolean
}

export interface ConnectionPickerModel {
  id: string
  label?: string
}

export interface ConnectionsSelectedPayload {
  profileId: string
  modelId?: string
}

export interface ConnectionsSelectionClearedPayload {
  previousProfileId?: string
}

export interface ConnectionsPickerBusPayloads {
  'connections/selected': ConnectionsSelectedPayload
  'connections/selection-cleared': ConnectionsSelectionClearedPayload
}

export interface ConnectionsPickerSelectionState {
  profileId: string | null
  modelId: string | null
}
