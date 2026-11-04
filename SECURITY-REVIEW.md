# Security review (pre-release, 04/11/2026)

Two passes over the original script (the one the field tests ran on): the author's own, and an independent one that did not see the author's reasoning. What each finding was, and what this release does about it.

| # | Sev | Finding (original script) | Status in this release |
|---|---|---|---|
| 1 | High | Root guard inherited the user's `PATH` (macOS sudo: `env_reset`, no `secure_path`). `/opt/homebrew/bin` is user-owned and comes first, so a planted `grep`/`pmset`/`date` ran as root every 10s. Plain `sudo` was also looked up in `PATH`, so a fake one could capture the password. | Fixed: fixed `PATH` in the script and in the guard, `cd /`, `/usr/bin/sudo` by absolute path. |
| 2 | High | `SleepDisabled=1` outlives a reboot, hard power-off or dead guard. `on` checked only the flag, so a leftover 1 hid a guard that never started. `--ac-only` never looked at it. | Fixed: `on` refuses while the flag is set. Startup and the loop check that the guard process is running (`pgrep -u root`). `status` warns. Optional `boot-reset` LaunchDaemon resets at boot when the root-only marker shows lid-awake set it. |
| 3 | Medium | sudo's real uid is the user's, and sudo relays signals to its child. USR1/USR2/QUIT/ALRM/PIPE killed the guard without its reset trap. TSTP froze it with the flag at 1. | Fixed: the guard is detached from sudo (sudo returns at once), traps all of these into the reset, and ignores HUP/TSTP/TTIN/TTOU. Tested with `pmset` stubbed. |
| 4 | Medium | The root code lives in a user-writable file and is passed to sudo as a string. Anything that can write the file gets root the next time you type the password. | Documented: this is true of any script you run with sudo. The README says to keep it where only you can write it. Option for later: install the guard as a root-owned file. |
| 5 | Medium | Apple menu > Sleep silently does nothing during a hold. | Documented, and `on` prints it. |
| 6 | Low-Med | Battery % taken from the first `NN%` in `pmset -g batt`; a UPS line could hide a low internal battery. | Fixed: `InternalBattery` line only. Unreadable values still fall back to releasing. |
| 7 | Low | Two `on` at once could both start, leaving an orphan loop. | Fixed: lock directory; the parent writes the pid file before the guard starts. |
| 8 | Low | `off` exited 0 even when the sudo reset failed (e.g. no TTY). | Fixed: non-zero exit and a message with the manual command. |
| 9 | Info | Guard and loop arguments reached `(( ))` unvalidated (same user only). `notify` put text into AppleScript source. | Fixed: digits-only with fail-safe fallbacks in both. The end time is clamped to 72h inside the guard. Notification text is passed as `argv`, not source. |
| 10 | Info | Wall-clock cap; system-wide flag; MDM; behaviour at 0% battery with sleep disabled unknown. | Documented. Minimum `--min-batt` raised from 5 to 10. |
| 11 | Info | Some Apple Silicon setups reportedly keep the internal panel lit under a closed lid with sleep disabled (third-party report). | Added `pmset displaysleepnow` on lid close. Not yet verified on hardware. |

## `--gui` path (added 04/11/2026 from hub commit db3d3cd)

`on --gui` / `off --gui` replace `sudo` with `osascript … do shell script (item 1 of argv) with administrator privileges`.

| # | Sev | Finding | Status |
|---|---|---|---|
| G1 | Info (good) | The command and the prompt are AppleScript `argv`, not source, so no AppleScript injection. `do shell script` uses `/bin/sh` with a fixed `PATH`. The guard is passed `${(qq)}`-quoted. | Kept. Verified: the generated command parses under `/bin/sh` and `zsh`, returns at once, and leaves the guard with ppid 1. |
| G2 | Medium | It trains users to type the admin password into a dialog raised by a script. Any process that can run the script (an agent session included) can raise it, and a tampered copy can show the same text and run something else. | Inherent to the GUI path, same root cause as #4. Documented in README; English prompt; the human still has to approve every root step. |
| G3 | Low (verify) | Real uid of the root process under `do shell script … with administrator privileges` not verified. If it stayed the user's, the user could signal the guard, so `zsh -f` (no `-p`) would drop privileges. | Fail-safe either way: without root, the guard cannot set the flag and `on` reports failure. TESTING.md checks `ps -o ruid` of the guard. |
| G4 | Low | `on --gui` blocks while the dialog is open; the loop holds `caffeinate` (AC only) meanwhile. | The loop waits at most 180s for the guard, then exits. `on` kills it on cancel. |
| G5 | Low | The hub version's `--gui` startup checked only `SleepDisabled`, and its `sudo` branch still ran `pmset` through the user's `PATH`. | Not in this draft (guard-alive check, fixed `PATH`). |
| G6 | Low | The loop's exit notification said "will sleep now" even if the flag was still 1 (e.g. the guard was SIGKILLed). | Fixed: waits up to 15s for the flag to drop, otherwise warns to run `off`. |

Pid reuse: the guard and `off` accept a pid only if its command line carries the loop marker, so the risk is negligible.

Not done (design choices for later): running the guard from launchd instead of sudo; restoring a previous non-zero `SleepDisabled` (`on` refuses in that case instead).
