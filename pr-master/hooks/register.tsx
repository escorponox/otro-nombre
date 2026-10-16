import type { Register } from 'claude-code'

import { readOptions } from './options'
import { registerPane } from './pane'
import { registerRefresh } from './refresh'

export const register: Register = (on, options) => {
  registerRefresh(on, readOptions(options))
  registerPane(on)
}
