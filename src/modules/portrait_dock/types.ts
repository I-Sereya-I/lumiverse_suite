export type PortraitDockMode = 'floating' | 'side-left' | 'side-right'

export interface PortraitDockRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface PortraitDockSettings {
  readonly version: 1
  readonly enabled: boolean
  readonly mode: PortraitDockMode
  readonly defaultDockSide: 'left' | 'right'
  readonly defaultAspectRatioLock: boolean
  readonly dockSide: 'left' | 'right' | 'floating'
  readonly open: boolean
  readonly openAtOriginalSize: boolean
  readonly pinned: boolean
  readonly rememberSizePosition: boolean
  readonly snapToEdge: boolean
  readonly hoverControls: boolean
  readonly hoverControlSize: number
  readonly aspectRatioLocked: boolean
  readonly minWidth: number
  readonly minHeight: number
  readonly maxWidth: number
  readonly maxHeight: number
  readonly rect: PortraitDockRect
  readonly lastPortrait: { readonly imageUrl: string; readonly displayName: string } | string | null
  readonly [key: string]: unknown
}

export interface PortraitActiveState {
  readonly chatId: string | null
  readonly characterId: string | null
  readonly avatarImageId: string | null
}

export interface PortraitViewModel {
  readonly chatId: string
  readonly characterId: string
  readonly name: string
  readonly imageUrl: string
  readonly source: string
}

export interface PortraitPreviewRequest {
  readonly imageUrl: string
  readonly caption?: string
  readonly source?: string
}

export interface PortraitDockBusPayloads {
  readonly 'portrait/active-character': PortraitViewModel | null
}
