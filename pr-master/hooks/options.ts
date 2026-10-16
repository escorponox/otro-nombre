import type { PluginOptions } from 'claude-code'

import type { StaleThreshold } from './domain/age'
import type { Visibility } from './domain/visibility'
import type { MergedWindow } from './github/merged'

/** The mod's `userConfig` values, typed. The engine fills in defaults and validates them before `register`. */
export interface Options extends Visibility {
  staleThreshold: StaleThreshold
  /** How far back the Merged tab looks. */
  mergedWindow: MergedWindow
  /** The sensitive GitHub token, used only when `gh auth token` gives none; '' when unset. */
  githubToken: string
}

export function readOptions(options: PluginOptions): Options {
  return {
    staleThreshold: options.staleThreshold as StaleThreshold,
    mergedWindow: options.mergedWindow as MergedWindow,
    githubToken: typeof options.githubToken === 'string' ? options.githubToken : '',
    hiddenOrgs: Array.isArray(options.hiddenOrgs) ? options.hiddenOrgs : [],
    showPrivate: options.showPrivate !== false,
  }
}
