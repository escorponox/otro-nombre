// PROTOTYPE: throwaway state contract for the pr-master panel variants.

export type Turn = 'mine' | 'theirs' | 'done' | 'parked'

export type Row = {
  id: string
  ref: string
  title: string
  url: string
  author: string
  turn: Turn
  label: string
  ageDays: number
}

export type ShipStep = 'arrived' | 'running' | 'failed' | 'unknown'

export type MergedRow = {
  id: string
  ref: string
  title: string
  url: string
  steps: { ci: ShipStep; release: ShipStep; stg: ShipStep; prod: ShipStep }
}

export type Snapshot = {
  login: string
  mine: Row[]
  review: Row[]
  merged: MergedRow[]
  fetchedAt: number
  diagnostics: string
}

declare module 'claude-code' {
  interface PluginState {
    'pr-master-proto': {
      snapshot: Snapshot | null
      variant: string
      tab: string
      legend: boolean
      armed: string
      selected: string
      note: string
      listOffset: number
    }
  }
}
