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
    forHow: 'For how long?',
    hoursShort: (h: number) => `${h}h`,
    custom: 'Other (hours, 0.5–72; 1.5 = an hour and a half)',
    badHours: 'Hours: 0.5 to 72, in half hours (1.5 = an hour and a half)',
    chipDefault: (h: number) => `A click on the chip beside the model picker turns it on for ${h}h (the hours option).`,
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
    forHow: 'לכמה זמן?',
    hoursShort: (h: number) => `${h} ש'`,
    custom: 'אחר (שעות, 0.5–72; 1.5 = שעה וחצי)',
    badHours: 'שעות: 0.5 עד 72, בחצאי שעה (1.5 = שעה וחצי)',
    chipDefault: (h: number) => `לחיצה על התווית ליד בחירת המודל מפעילה ל-${h} שעות (ההגדרה hours).`,
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

const DURATIONS = [1, 2, 4, 8, 12, 24]
// Hours from the `hours` option or a typed value: whole or half hours from 0.5 to 72 (1.5 = an hour and a half), as
// lid-awake.sh accepts; anything else is not one.
function asHours(v: unknown): number | undefined {
  const h = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+(\.[05])?\s*$/.test(v) ? Number(v) : NaN
  return Number.isInteger(h * 2) && h >= 0.5 && h <= 72 ? h : undefined
}

const script = ($: Engine, args: readonly string[]) => ['/bin/zsh', '-f', `${$.plugin.root}/lid-awake.sh`, ...args]

async function refresh($: Engine): Promise<void> {
  try {
    const { exitCode, stdout } = await $.process.run(script($, ['state']), { timeoutMs: 10_000 })
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

async function toggle($: Engine, t: Strings, hours: number): Promise<void> {
  const cur = await read($, lid)
  if (cur.busy || cur.failed || !cur.hasLid) return
  const turnOn = !cur.on && !cur.sleepDisabled
  await update($, lid, prev => ({ ...prev, busy: true }))
  try {
    // Touch ID or the password dialog waits for the person, so allow two minutes
    const args = turnOn ? ['on', '--gui', '--hours', String(hours)] : ['off', '--gui']
    const { exitCode, stdout } = await $.process.run(script($, args), { timeoutMs: 120_000 })
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
  const hours = asHours(options.hours) ?? 12 // what a click on the chip turns it on for

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
      <Box flexDirection="row" gap={1} alignItems="center">
        <Button key="lid-chip" plain onPress={() => void toggle($, t, hours)}>
          {/* the desktop draws any button here as a compact pill of its own size; tried 04/11: no plain, a larger text and padding all leave it the same or cut it to "…" */}
          <Text size="body" color={c.color} dimColor={!c.color}>{rtl(c.text)}</Text>
        </Button>
        {below}
      </Box>
    )
  })

  // State and what ends it. Off: how long (quick choices, the default first marked, or any 1-72); on: one button off.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Input = 'Input' in els ? els.Input : undefined // the mobile app draws no field yet
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
        {l.on || l.sleepDisabled || l.busy ? (
          <Box flexDirection={isHe ? 'row-reverse' : 'row'}>
            <Button key="lid-toggle" variant="secondary" onPress={() => void toggle($, t, hours)}>
              {rtl(l.busy ? t.wait : t.turnOff)}
            </Button>
          </Box>
        ) : (
          <Box flexDirection="column" gap={1}>
            <Text weight="medium">{rtl(t.forHow)}</Text>
            <Box flexDirection={isHe ? 'row-reverse' : 'row'} gap={1} flexWrap="wrap">
              {DURATIONS.map(n => ( // not `h`: that is the JSX factory
                <Button key={`lid-h-${n}`} variant={n === hours ? 'primary' : 'secondary'} onPress={() => void toggle($, t, n)}>
                  {rtl(t.hoursShort(n))}
                </Button>
              ))}
            </Box>
            {Input && <Input
              key="lid-hours"
              label={rtl(t.custom)}
              placeholder="6"
              submitLabel={rtl(t.turnOn)}
              onSubmit={(value: string) => {
                const n = asHours(value)
                if (n === undefined) $.ui.toast(t.badHours)
                else void toggle($, t, n)
              }}
            />}
            <Text dimColor size="footnote">{rtl(t.chipDefault(hours))}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
