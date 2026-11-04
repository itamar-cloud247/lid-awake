# Test checklist for the hardened release

The original script passed two closed-lid battery runs: 5 min with 52 samples, and 15.5 min with 177 samples, no failures and no sleep. This release changes how the root guard starts and adds new paths. Run these on a real Mac before publishing. Run them yourself, since several need `sudo`.

Done without root (04/11/2026 draft):
- [x] `zsh -n`. Bad options rejected (`--hours 99`, `--min-batt 'a[$(id)]'`).
- [x] Loop started with junk arguments → end=0, min_batt=100, ac_only=1 → exits "cap reached" at once. No command substitution ran.
- [x] `as_root` guard command (stubbed guard) under `/bin/sh -c` (as `do shell script` runs it) and `zsh -f -c`: returns at once, guard ppid 1, marker set, removed on TERM.
- [x] Mod: `claude plugin validate` passes (only an icon warning); `claude plugin test` 8/8 on desktop and terminal (on, left on, a press runs `on --gui` on the bundled script, no answer = macOS only); `tsc` strict clean.
- [x] Guard snippet with `pmset`/`logger` stubbed: bad pid refuses to start. Junk min/end → ends at once ("cap"). End beyond 72h clamped. Loop killed → "loop gone". USR1 → reset ("signal"). HUP and TSTP ignored (state `S`, not `T`). TERM → reset.

Needs a real run (sudo):
- [ ] `on`: `/var/db/lid-awake.active` exists; guard appears as a root process with ppid 1 (`pgrep -u root -lf lid-awake-guard`), `SleepDisabled=1`, `status` shows "root guard: running".
- [ ] Close the Terminal window right after `on` → hold continues (`status` from a new window).
- [ ] `off` → loop gone, guard gone within 10s, `SleepDisabled=0`, syslog line `guard: disablesleep 0 (loop gone)`.
- [ ] Battery + lid closed 15 min over a hotspot: no `Sleep` in `pmset -g log`, internet/VPN up, and the internal panel is dark under the lid (`displaysleepnow`).
- [ ] `on --min-batt 90` on battery below 90% → guard resets within 10s, loop notifies.
- [ ] `sudo kill <guard pid>` → loop stops with "root guard gone" within 30s, `SleepDisabled=0`.
- [ ] `on` while `SleepDisabled=1` is set by hand (`sudo pmset -a disablesleep 1`) → refuses; `off` clears it.
- [ ] `boot-reset install` while a hold runs → hold is not interrupted. Reboot mid-hold → `SleepDisabled=0` and the marker is gone. `sudo pmset -a disablesleep 1` by hand (no marker) + reboot → still 1 (left alone). `boot-reset uninstall` removes it. Check whether your EDR alerted.
- [ ] Two `on` at the same moment (two Terminal tabs) → one starts, the other says another `on` is starting.
- [ ] `sudo -k; ./lid-awake.sh on` with `Defaults timestamp_timeout=0` → "sudo -n failed", nothing left running.
- [ ] `on --gui`: macOS dialog appears with the English prompt; Cancel → "no admin rights … stopped", nothing left running. OK → guard running with ppid 1 and **`ps -o ruid= -p <guard>` = 0**; `state` prints `on 1 HH:MM full`.
- [ ] Leave the `--gui` dialog open 2 min, then OK → hold starts (loop waits up to 180s).
- [ ] `sudo kill -9 <guard>` → loop exits, notification warns that SleepDisabled is still 1; `off --gui` clears it.
- [ ] With `pam_tid` in `/etc/pam.d/sudo_local`: `on --gui` asks for Touch ID first; cancel → the password dialog appears (no hang). Same from a Terminal.
- [ ] Mod: install from a local marketplace (`claude plugin marketplace add ~/Documents/lid-awake`, then install), open Claude Desktop → the "Lid closed" pane appears; Turn on → Touch ID/password → green "On until HH:MM"; Turn off → "Off"; `/lid-awake` reopens the pane.
- [ ] `on --ac-only` (no sudo) on AC, lid closed 5 min → awake; unplug → sleeps.
