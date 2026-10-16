import type { Register } from 'claude-code'

import { registerPane } from './pane'

export const register: Register = on => {
  registerPane(on)
}
