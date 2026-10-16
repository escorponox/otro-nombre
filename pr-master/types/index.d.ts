/** The panel's tabs: My pull requests, Review requests, Merged pull requests. */
export type Tab = 'mine' | 'review' | 'merged'

declare module 'claude-code' {
  interface PluginState {
    'pr-master': {
      /** The tab the panel shows. */
      tab: Tab
      /** Whether the colour legend is shown. */
      legend: boolean
    }
  }
}
