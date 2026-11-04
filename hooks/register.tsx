import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { LidState } from '../types'

// A small chip beside the model picker (its color says the state, a click turns it on or off) and a "Lid closed"
// pane with the details (`/lid-awake`). Both run the lid-awake.sh that ships beside this mod: `state` every 30 s, and
// `on --gui` / `off --gui` on a press. The mod itself runs nothing as root: the admin step is the script's, through
// Touch ID for sudo (when the Mac has pam_tid) or macOS's own password dialog.
const PANE = 'lid-awake'
const TITLE = 'Lid closed'
const OFF: LidState = { known: false, failed: false, on: false, sleepDisabled: false, until: '', mode: '', busy: false }
const lid = atom({ plugin: 'lid-awake', key: 'lid' } as const, OFF)

// The chip: off dim, on green with the end time, left on by a restart or crash red (a click resets it).
function chip(l: LidState): { text: string; color?: string } {
  if (l.busy) return { text: '◌ Lid…' }
  if (l.on) return { text: `☀ Awake${l.until ? ` until ${l.until}` : ''}${l.mode === 'ac' ? ' (AC)' : ''}`, color: 'success' }
  if (l.sleepDisabled) return { text: '⚠ Sleep disabled', color: 'error' }
  return { text: '☾ Lid: sleep' }
}

const script = ($: Engine, ...args: string[]) => ['/bin/zsh', '-f', `${$.plugin.root}/lid-awake.sh`, ...args]

async function refresh($: Engine): Promise<void> {
  try {
    const { exitCode, stdout } = await $.process.run(script($, 'state'), { timeoutMs: 10_000 })
    const [state, sd, until, mode] = stdout.trim().split(/\s+/)
    if (exitCode !== 0 || (state !== 'on' && state !== 'off')) {
      await update($, lid, prev => ({ ...prev, known: true, failed: true }))
      return
    }
    await update($, lid, prev => ({
      ...prev,
      known: true,
      failed: false,
      on: state === 'on',
      sleepDisabled: sd === '1',
      until: until && until !== '-' ? until : '',
      mode: mode && mode !== '-' ? mode : '',
    }))
  } catch {
    await update($, lid, prev => ({ ...prev, known: true, failed: true }))
  }
}

async function toggle($: Engine): Promise<void> {
  const cur = await read($, lid)
  if (cur.busy || cur.failed) return
  const turnOn = !cur.on && !cur.sleepDisabled
  await update($, lid, prev => ({ ...prev, busy: true }))
  try {
    // Touch ID or the password dialog waits for the person, so allow two minutes
    const { exitCode, stdout } = await $.process.run(script($, turnOn ? 'on' : 'off', '--gui'), { timeoutMs: 120_000 })
    if (turnOn) {
      $.ui.toast(exitCode === 0
        ? 'Lid closed: on. The Mac stays awake until you turn it off, on battery too.'
        : 'Not turned on (approval cancelled?)')
    } else {
      $.ui.toast(/still 1/.test(stdout)
        ? 'Lid closed: off (SleepDisabled reset to 0)'
        : 'Lid closed: off. Closing the lid sleeps as usual.')
    }
  } catch {
    $.ui.toast('lid-awake.sh did not answer')
  } finally {
    await update($, lid, prev => ({ ...prev, busy: false }))
    await refresh($)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'lid-awake', description: 'Open the "Lid closed" pane (keep the Mac awake with the lid closed)' })
    // it can also be switched from a terminal or end by itself (cap, low battery, heat), so poll it
    void refresh($)
    $.clock.every(30_000, () => void refresh($))
    return next(e)
  })

  on('command.run', { command: 'lid-awake' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'The "Lid closed" pane is open.' }
  })

  // The chip beside the model picker, before the engine's own mode labels (kept as they are).
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const below = await next(e)
    const l = await read($, lid)
    if (!l.known || l.failed) return below
    const { Box, Text, Button } = $.ui.resolve(e)
    const c = chip(l)
    return (
      <Box flexDirection="row" gap={1}>
        <Button key="lid-chip" plain onPress={() => void toggle($)}>
          <Text color={c.color} dimColor={!c.color}>{c.text}</Text>
        </Button>
        {below}
      </Box>
    )
  })

  // State, what ends it, one button.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const l = await read($, lid)
    if (!l.known) return <Text dimColor>Checking lid-awake…</Text>
    if (l.failed) return <Text dimColor>lid-awake.sh did not answer. It runs on macOS only.</Text>
    // on: green with the end time; off: dim; left on by a crash or restart (SleepDisabled=1, no loop): red, a press resets it
    const head = l.busy
      ? 'One moment… (waiting for Touch ID / password)'
      : l.on
        ? `● On${l.until ? ` until ${l.until}` : ''}${l.mode === 'ac' ? ' (on AC only)' : ''}`
        : l.sleepDisabled
          ? '⚠ Left on with nothing watching it (restart or crash)'
          : '○ Off'
    const color = l.busy ? undefined : l.on ? 'success' : l.sleepDisabled ? 'error' : undefined
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={color} weight="semibold">{head}</Text>
        <Text dimColor>
          {l.on || l.sleepDisabled
            ? 'Closing the lid does not sleep the Mac, on battery too. It ends by itself at the end time, at 15% battery or on heavy heat.'
            : 'When on, you can close the lid and Claude keeps working (internet and VPN stay up). Approve with Touch ID or your password.'}
        </Text>
        <Box flexDirection="row">
          <Button key="lid-toggle" variant={l.on ? 'secondary' : 'primary'} onPress={() => void toggle($)}>
            {l.busy ? 'One moment…' : l.on || l.sleepDisabled ? 'Turn off' : 'Turn on'}
          </Button>
        </Box>
      </Box>
    )
  })
}
