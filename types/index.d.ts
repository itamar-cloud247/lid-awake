// lid-awake.sh `state`, read every 30 s and after each press.
export type LidState = {
  known: boolean          // a `state` answer has come back
  failed: boolean         // the script did not answer (not macOS, or missing)
  on: boolean             // the loop runs
  sleepDisabled: boolean  // pmset SleepDisabled=1 (a closed lid stays awake on battery)
  until: string           // "HH:MM" or ""
  mode: string            // "full" | "ac" | ""
  busy: boolean           // an on/off press is in flight
}

declare module 'claude-code' {
  interface PluginState {
    'lid-awake': { lid: LidState }
  }
}
