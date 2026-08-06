export interface LorebookTokenCountUpdatedPayload {
  readonly bookId: string
  readonly entryId: string
  readonly count: number
  readonly approximate: boolean
  readonly model?: string
}

export interface LorebookTokenRefreshRequestedPayload {
  readonly bookId: string
  readonly entryId: string
}

export interface LorebookTokenCountsBusPayloads {
  'tokens/count-updated': LorebookTokenCountUpdatedPayload
  'tokens/refresh-requested': LorebookTokenRefreshRequestedPayload
}
