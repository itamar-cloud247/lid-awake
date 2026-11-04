import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { LidState } from '../types'

// A small chip beside the model picker (its color says the state, a click turns it on or off) and a "Lid closed"
// pane with the details (`/lid-awake`). Both run the lid-awake.sh that ships beside this mod: `state` every 30 s, and
// `on --gui` / `off --gui` on a press. The mod itself runs nothing as root: the admin step is the script's, through
// Touch ID for sudo (when the Mac has pam_tid) or macOS's own password dialog. Labels in English or Hebrew: the
// `language` option.
const PANE = 'lid-awake'
const OFF: LidState = { known: false, failed: false, hasLid: true, on: false, sleepDisabled: false, until: '', mode: '', busy: false }
const lid = atom({ plugin: 'lid-awake', key: 'lid' } as const, OFF)

const RTL_START = '‏‫' // RLM + right-to-left embedding
const RTL_END = '‬'

const TEXT = {
  en: {
    title: 'Lid closed',
    command: 'Open the "Lid closed" pane (keep the Mac awake with the lid closed)',
    opened: 'The "Lid closed" pane is open.',
    chipBusy: '◌ Lid…',
    chipOn: (until: string, ac: boolean) => `☀ Awake${until ? ` until ${until}` : ''}${ac ? ' (AC)' : ''}`,
    chipLeft: '⚠ Sleep disabled',
    chipOff: '☾ Lid: sleep',
    turnedOn: 'Lid closed: on. The Mac stays awake until you turn it off, on battery too.',
    notOn: 'Not turned on (approval cancelled?)',
    offReset: 'Lid closed: off (SleepDisabled reset to 0)',
    off: 'Lid closed: off. Closing the lid sleeps as usual.',
    noAnswer: 'lid-awake.sh did not answer',
    checking: 'Checking lid-awake…',
    macOnly: 'lid-awake.sh did not answer. It runs on macOS only.',
    noLid: 'This Mac has no lid, so there is nothing to keep awake when it closes.',
    busy: 'One moment… (waiting for Touch ID / password)',
    headOn: (until: string, ac: boolean) => `● On${until ? ` until ${until}` : ''}${ac ? ' (on AC only)' : ''}`,
    headLeft: '⚠ Left on with nothing watching it (restart or crash)',
    headOff: '○ Off',
    whenOn: 'Closing the lid does not sleep the Mac, on battery too. It ends by itself at the end time, at 15% battery or on heavy heat.',
    whenOff: 'When on, you can close the lid and Claude keeps working (internet and VPN stay up). Approve with Touch ID or your password.',
    wait: 'One moment…',
    turnOff: 'Turn off',
    turnOn: 'Turn on',
  },
  he: {
    title: 'מכסה סגור',
    command: 'פותח את החלונית "מכסה סגור" (Mac ער עם מכסה סגור)',
    opened: 'החלונית "מכסה סגור" נפתחה',
    chipBusy: '◌ רגע…',
    chipOn: (until: string, ac: boolean) => `☀ ער${until ? ` עד ${until}` : ''}${ac ? ' (מטען)' : ''}`,
    chipLeft: '⚠ שינה כבויה',
    chipOff: '☾ מכסה: ישן',
    turnedOn: 'מכסה סגור: פעיל. ה-Mac יישאר ער עד שתכבה, גם על סוללה',
    notOn: 'לא הופעל (האישור בוטל?)',
    offReset: 'מכסה סגור: כבוי (SleepDisabled הוחזר ל-0)',
    off: 'מכסה סגור: כבוי. סגירת מכסה תרדים כרגיל',
    noAnswer: 'lid-awake.sh לא הגיב',
    checking: 'בודק את lid-awake…',
    macOnly: 'lid-awake.sh לא הגיב. הוא רץ רק ב-macOS.',
    noLid: 'ל-Mac הזה אין מכסה, אז אין מה להשאיר ער כשהוא נסגר.',
    busy: 'רגע… (מחכה לאישור Touch ID / סיסמה)',
    headOn: (until: string, ac: boolean) => `● פעיל${until ? ` עד ${until}` : ''}${ac ? ' (רק על מטען)' : ''}`,
    headLeft: '⚠ נשאר דלוק בלי שמירה (Restart או קריסה)',
    headOff: '○ כבוי',
    whenOn: 'סגירת מכסה לא מרדימה את ה-Mac, גם על סוללה. נכבה לבד בשעת הסיום, ב-15% סוללה או בחום כבד.',
    whenOff: 'כשפעיל, אפשר לסגור את המכסה ו-Claude ממשיך לעבוד (אינטרנט ו-VPN נשארים). אישור ב-Touch ID או בסיסמה.',
    wait: 'רגע…',
    turnOff: 'לכבות',
    turnOn: 'להפעיל',
  },
}
type Strings = (typeof TEXT)['en']

// The chip: off dim, on green with the end time, left on by a restart or crash red (a click resets it).
function chip(t: Strings, l: LidState): { text: string; color?: string } {
  if (l.busy) return { text: t.chipBusy }
  if (l.on) return { text: t.chipOn(l.until, l.mode === 'ac'), color: 'success' }
  if (l.sleepDisabled) return { text: t.chipLeft, color: 'error' }
  return { text: t.chipOff }
}

const script = ($: Engine, ...args: string[]) => ['/bin/zsh', '-f', `${$.plugin.root}/lid-awake.sh`, ...args]

async function refresh($: Engine): Promise<void> {
  try {
    const { exitCode, stdout } = await $.process.run(script($, 'state'), { timeoutMs: 10_000 })
    const [state, sd, until, mode, lidKind] = stdout.trim().split(/\s+/)
    if (exitCode !== 0 || (state !== 'on' && state !== 'off')) {
      await update($, lid, prev => ({ ...prev, known: true, failed: true }))
      return
    }
    await update($, lid, prev => ({
      ...prev,
      known: true,
      failed: false,
      hasLid: lidKind !== 'nolid', // an older script prints no fifth field
      on: state === 'on',
      sleepDisabled: sd === '1',
      until: until && until !== '-' ? until : '',
      mode: mode && mode !== '-' ? mode : '',
    }))
  } catch {
    await update($, lid, prev => ({ ...prev, known: true, failed: true }))
  }
}

async function toggle($: Engine, t: Strings): Promise<void> {
  const cur = await read($, lid)
  if (cur.busy || cur.failed || !cur.hasLid) return
  const turnOn = !cur.on && !cur.sleepDisabled
  await update($, lid, prev => ({ ...prev, busy: true }))
  try {
    // Touch ID or the password dialog waits for the person, so allow two minutes
    const { exitCode, stdout } = await $.process.run(script($, turnOn ? 'on' : 'off', '--gui'), { timeoutMs: 120_000 })
    if (turnOn) $.ui.toast(exitCode === 0 ? t.turnedOn : t.notOn)
    else $.ui.toast(/still 1/.test(stdout) ? t.offReset : t.off)
  } catch {
    $.ui.toast(t.noAnswer)
  } finally {
    await update($, lid, prev => ({ ...prev, busy: false }))
    await refresh($)
  }
}

export const register: Register = (on, options) => {
  const isHe = options.language === 'he'
  const t: Strings = isHe ? TEXT.he : TEXT.en
  const rtl = (s: string) => (isHe ? `${RTL_START}${s}${RTL_END}` : s)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'lid-awake', description: t.command })
    // it can also be switched from a terminal or end by itself (cap, low battery, heat), so poll it
    void refresh($)
    $.clock.every(30_000, () => void refresh($))
    return next(e)
  })

  on('command.run', { command: 'lid-awake' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: t.title })
    return { text: t.opened }
  })

  // The chip beside the model picker, before the engine's own mode labels (kept as they are).
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const below = await next(e)
    const l = await read($, lid)
    // nothing to show where the script cannot run, or on a Mac with no lid (iMac, Mac mini, Studio)
    if (!l.known || l.failed || !l.hasLid) return below
    const { Box, Text, Button } = $.ui.resolve(e)
    const c = chip(t, l)
    return (
      <Box flexDirection="row" gap={1}>
        <Button key="lid-chip" plain onPress={() => void toggle($, t)}>
          <Text color={c.color} dimColor={!c.color}>{rtl(c.text)}</Text>
        </Button>
        {below}
      </Box>
    )
  })

  // State, what ends it, one button.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const l = await read($, lid)
    if (!l.known) return <Text dimColor>{rtl(t.checking)}</Text>
    if (l.failed) return <Text dimColor>{rtl(t.macOnly)}</Text>
    if (!l.hasLid) return <Text dimColor>{rtl(t.noLid)}</Text>
    // on: green with the end time; off: dim; left on by a crash or restart (SleepDisabled=1, no loop): red, a press resets it
    const head = l.busy ? t.busy : l.on ? t.headOn(l.until, l.mode === 'ac') : l.sleepDisabled ? t.headLeft : t.headOff
    const color = l.busy ? undefined : l.on ? 'success' : l.sleepDisabled ? 'error' : undefined
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={color} weight="semibold">{rtl(head)}</Text>
        <Text dimColor>{rtl(l.on || l.sleepDisabled ? t.whenOn : t.whenOff)}</Text>
        <Box flexDirection={isHe ? 'row-reverse' : 'row'}>
          <Button key="lid-toggle" variant={l.on ? 'secondary' : 'primary'} onPress={() => void toggle($, t)}>
            {rtl(l.busy ? t.wait : l.on || l.sleepDisabled ? t.turnOff : t.turnOn)}
          </Button>
        </Box>
      </Box>
    )
  })
}
