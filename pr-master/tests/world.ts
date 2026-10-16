import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

export const PLUGIN = 'pr-master'
export const PANE_ID = 'pr-master'
export const SURFACES = ['terminal', 'desktop'] as const

/** The Pane's mount arguments as a docked pane on `surface`. */
export function paneMount(surface: (typeof SURFACES)[number]) {
  return {
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: PANE_ID,
    props: { title: 'PR Master', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as const
}

/**
 * The world beneath the mod, answered as Claude Code would: the session's panes
 * (`open` is the engine's pane record) and the commands the mod registers.
 * Call before the first call on `$`.
 */
export function world(on: On) {
  const open = new Set<string>()
  /** Every `$.ui.open` the mod made, with its arguments. */
  const opens: { id: string; focus?: boolean }[] = []
  const commands: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => { commands.push(e.name); return { value: { command: e.name } } })
  on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.open', ($, e) => { open.add(e.id); opens.push({ id: e.id, focus: e.focus }); return { value: { isPlaced: true } } })
  on('ui.close', ($, e) => { open.delete(e.id); return { value: undefined } })
  return { open, opens, commands }
}

export async function startSession($: Engine) {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true } as never)
}

export async function runPrs($: Engine) {
  return $.command.run({ command: 'prs', args: '' } as never)
}
