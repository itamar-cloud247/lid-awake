import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const PANE = {
  plugin: 'lid-awake',
  component: 'Pane',
  requestId: 'lid-awake',
  props: {
    title: 'Lid closed',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

// The arguments after the script path of the first `on` run, or undefined.
const onArgs = (runs: string[][]) => runs.map(a => a.slice(3)).find(a => a[0] === 'on')

// Stands for the engine beneath the mod: lid-awake.sh `state` answers `answer` (exit `code`), other runs succeed.
function engine(on: Parameters<TestBody>[1], answer: string, runs: string[][] = [], code = 0) {
  on('clock.every', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'lid-awake' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    const isState = e.argv.at(-1) === 'state'
    return { value: { exitCode: isState ? code : 0, stdout: isState ? answer : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // the engine's own mode labels beneath the chip
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.modes.join(' & ')}</Text>
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`${surface}: on shows the end time`, async ($, on) => {
    engine(on, 'on 1 06:13 full\n')
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /On/ }))?.text).toContain('● On until 06:13')
    await ui.unmount()
  })

  test(`${surface}: left on by a crash`, async ($, on) => {
    engine(on, 'off 1 - -\n')
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Left on/ }))?.text).toContain('Left on')
    await ui.unmount()
  })

  test(`${surface}: a press when off runs the bundled script with on --gui`, async ($, on) => {
    const runs: string[][] = []
    engine(on, 'off 0 - -\n', runs)
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Off/ }))?.text).toContain('○ Off')
    await ui.press({ key: 'lid-h-12' })
    const run = runs.find(a => a[3] === 'on')
    expect(run?.[2]).toMatch(/\/lid-awake\.sh$/)
    expect(onArgs(runs)).toEqual(['on', '--gui', '--hours', '12'])
    await ui.unmount()
  })

  test(`${surface}: chip when on is green with the end time, engine labels kept`, async ($, on) => {
    const runs: string[][] = []
    engine(on, 'on 1 06:13 full\n', runs)
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    const up = await $.ui.mount({ plugin: 'lid-awake', surface, component: 'SessionMode', props: { modes: ['focus'] } })
    expect((await up.find({ type: 'Text', text: /Awake/ }))?.text).toContain('☀ Awake until 06:13')
    expect((await up.find({ type: 'Text', text: /focus/ }))?.text).toBe('focus')
    await up.unmount()
  })

  test(`${surface}: chip when off, and a click`, async ($, on) => {
    const runs: string[][] = []
    engine(on, 'off 0 - -\n', runs)
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'lid-awake', surface, component: 'SessionMode', props: { modes: [] } })
    expect((await ui.find({ type: 'Text', text: /Lid/ }))?.text).toContain('☾ Lid: sleep')
    await ui.press({ key: 'lid-chip' })
    expect(onArgs(runs)).toEqual(['on', '--gui', '--hours', '12'])
    await ui.unmount()
  })

  test(`${surface}: no answer (not macOS) says so and a press does nothing`, async ($, on) => {
    const runs: string[][] = []
    engine(on, '', runs, 127)
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /did not answer/ }))?.text).toContain('macOS only')
    expect(onArgs(runs)).toBeUndefined()
    await ui.unmount()
  })
}

test('Hebrew with language: he', { options: { language: 'he' } }, async ($, on) => {
  engine(on, 'on 1 06:13 full\n')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'lid-awake', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  expect((await ui.find({ type: 'Text', text: /ער/ }))?.text).toContain('☀ ער עד 06:13')
  await ui.unmount()
})

test('no chip on a Mac with no lid, and a press does nothing', async ($, on) => {
  const runs: string[][] = []
  engine(on, 'off 0 - - nolid\n', runs)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const chip = await $.ui.mount({ plugin: 'lid-awake', surface: 'desktop', component: 'SessionMode', props: { modes: ['focus'] } })
  expect(await chip.find({ type: 'Text', text: /Lid/ })).toBeFalsy()
  expect((await chip.find({ type: 'Text', text: /focus/ }))?.text).toBe('focus')
  await chip.unmount()
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await pane.find({ type: 'Text', text: /no lid/ }))?.text).toContain('no lid')
  await pane.unmount()
  expect(onArgs(runs)).toBeUndefined()
})

test('the hours option sets what the chip turns it on for', { options: { hours: 3 } }, async ($, on) => {
  const runs: string[][] = []
  engine(on, 'off 0 - - lid\n', runs)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'lid-awake', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  await ui.press({ key: 'lid-chip' })
  expect(onArgs(runs)).toEqual(['on', '--gui', '--hours', '3'])
  await ui.unmount()
})

test('pane: a quick duration, a custom one, and a bad one', async ($, on) => {
  const runs: string[][] = []
  engine(on, 'off 0 - - lid\n', runs)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'lid-h-4' })
  expect(onArgs(runs)).toEqual(['on', '--gui', '--hours', '4'])
  runs.length = 0
  await ui.input({ key: 'lid-hours', text: '99' })
  expect(onArgs(runs)).toBeUndefined()
  await ui.input({ key: 'lid-hours', text: '6' })
  expect(onArgs(runs)).toEqual(['on', '--gui', '--hours', '6'])
  runs.length = 0
  await ui.input({ key: 'lid-hours', text: '1.25' })
  expect(onArgs(runs)).toBeUndefined()
  await ui.input({ key: 'lid-hours', text: '1.5' })
  expect(onArgs(runs)).toEqual(['on', '--gui', '--hours', '1.5'])
  await ui.unmount()
})

test('the hours option takes half hours', { options: { hours: 0.5 } }, async ($, on) => {
  const runs: string[][] = []
  engine(on, 'off 0 - - lid\n', runs)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'lid-awake', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  await ui.press({ key: 'lid-chip' })
  expect(onArgs(runs)).toEqual(['on', '--gui', '--hours', '0.5'])
  await ui.unmount()
})
