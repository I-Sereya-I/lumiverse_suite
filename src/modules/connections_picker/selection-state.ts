import type {
  ConnectionsPickerBusPayloads,
  ConnectionsPickerSelectionState,
  ConnectionsSelectedPayload,
} from './types'

export const emptyConnectionsPickerSelection = (): ConnectionsPickerSelectionState => ({ profileId: null, modelId: null })

export function selectConnectionProfile(profileId: string): ConnectionsPickerSelectionState {
  return { profileId, modelId: null }
}

export function selectConnectionModel(
  state: ConnectionsPickerSelectionState,
  modelId: string,
): { state: ConnectionsPickerSelectionState; event: ConnectionsSelectedPayload } | undefined {
  if (!state.profileId) return undefined
  return { state: { profileId: state.profileId, modelId }, event: { profileId: state.profileId, modelId } }
}

export function clearConnectionSelection(
  state: ConnectionsPickerSelectionState,
): { state: ConnectionsPickerSelectionState; event: ConnectionsPickerBusPayloads['connections/selection-cleared'] } {
  return { state: emptyConnectionsPickerSelection(), event: { previousProfileId: state.profileId ?? undefined } }
}
