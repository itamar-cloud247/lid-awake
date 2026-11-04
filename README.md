# lid-awake

Keep a MacBook awake with the lid closed, **on battery too**, for as long as you choose. Then let it sleep again. One zsh script, no app, no kernel extension, nothing left installed.

Written so a long-running job keeps going while the laptop is in a bag: Claude Desktop working through a task, a VPN session, a download.

[עברית למטה](#עברית)

## Install it by asking Claude

Give Claude (Claude Code in the terminal, or the Code tab of the Claude desktop app) this repository's link and say:

> Install the lid-awake mod from <this repository's link>

Claude reads [Instructions for Claude](#instructions-for-claude) below, checks that your Mac fits, tells you what the mod does and asks before installing it. You do the one thing it must not do for you: approve each turn-on with Touch ID or your password.

## Requirements

* **A MacBook.** On a Mac with no lid (iMac, Mac mini, Mac Studio) the chip stays hidden and `on` refuses: there is nothing to keep awake when a lid closes.
* **macOS with its own tools only:** `pmset`, `caffeinate`, `ioreg`, `notifyutil`, `osascript`, `/bin/zsh`. No Homebrew. Tested on macOS 27, Apple Silicon (M3 Max). Intel Macs and older macOS versions have the same tools but have not been tested.
* **An admin account**, or an admin's name and password: each turn-on asks for admin rights.
* **Not blocked by your IT.** A managed (MDM) Mac may block or flag `pmset disablesleep`, and EDR may flag `boot-reset` as persistence.
* **For the mod:** Claude Code 2.1.309 or later (the mod API, early access), in the terminal or the desktop app's Code tab. The script works without it.

## Quick start

```bash
curl -fsSLO https://raw.githubusercontent.com/itamar-cloud247/lid-awake/main/lid-awake.sh   # or clone the repo
chmod +x lid-awake.sh
./lid-awake.sh on        # asks your sudo password once; AC + battery, cap 12h, releases at 15% battery
# close the lid, go
./lid-awake.sh off       # when you are back
./lid-awake.sh status
```

### As a Claude mod (one small chip)

The repository is also a Claude Code plugin. It puts a small chip beside the model picker, colored by state, and one click turns it on or off:

| Chip | Meaning |
|---|---|
| `☾ Lid: sleep` (dim) | Off: closing the lid sleeps as usual. |
| `☀ Awake until 06:13` (green) | On, until that time. |
| `⚠ Sleep disabled` (red) | `SleepDisabled` was left on by a restart or crash. A click resets it. |

**How long:** a click on the chip turns it on for the `hours` option (12 by default, any whole number from 1 to 72). `/lid-awake` opens a pane with the details, quick choices (1, 2, 4, 8, 12, 24 hours) and a field for any other number of hours. The mod runs the bundled `lid-awake.sh` (`state` every 30s, `on --gui` / `off --gui` on a click). You approve with Touch ID (when sudo has `pam_tid`) or macOS's password dialog. The mod itself runs nothing as root. The labels are in English or Hebrew: the `language` option (`en` or `he`).

```
/plugin install lid-awake --marketplace itamar-cloud247/lid-awake
```

From a shell: `claude plugin install lid-awake --marketplace itamar-cloud247/lid-awake` (add `--config language=he` for Hebrew, `--config hours=4` for a 4-hour default). In the Claude desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `itamar-cloud247/lid-awake`, then **Add plugin**. Then run `/reload-plugins`, or open a new session.

Read the script before you run it with sudo. It is under 200 lines. Keep it where only you can write it: whatever is in the file runs as root the next time you type your password.

| Command | What it does |
|---|---|
| `on [--hours 1-72] [--min-batt 10-90]` | AC and battery. Needs sudo once. Defaults: 12h, 15%. |
| `on --ac-only [--until-idle]` | No sudo. Holds only while plugged in. Unplugged + lid closed sleeps as usual. `--until-idle` lets go 10 min after Claude Desktop stops working. |
| `on --gui` / `off --gui` | Same, but admin rights come from Touch ID (if sudo has `pam_tid`) or macOS's own password dialog instead of `sudo` in a terminal. What the mod's button runs. |
| `off` | Stops the hold. If `SleepDisabled` is still 1 after 12s, resets it (sudo) and exits non-zero if that fails. |
| `state` | One line for widgets: `on\|off <SleepDisabled 0\|1> <until HH:MM\|-> <full\|ac\|-> <lid\|nolid>`. |
| `status` | Loop, root guard, `SleepDisabled`, power assertions, last log lines. Warns about a leftover `SleepDisabled=1`. |
| `boot-reset install` / `uninstall` | Optional. A one-line root job that, at every boot, runs `pmset -a disablesleep 0` if lid-awake was the one that set it. See [Risks](#risks). |

## Why Claude Desktop's keep-awake and `caffeinate` are not enough

macOS has two different kinds of sleep:

* **Idle sleep** – nobody touched the Mac for a while. Claude Desktop's *keep awake* setting, and most "keep awake" apps, take a power assertion (`PreventUserIdleSystemSleep` / `NoIdleSleepAssertion`) against this one. It works while the lid is open.
* **Clamshell sleep** – you closed the lid. This ignores idle-sleep assertions. With the keep-awake setting on, a closed lid still went to sleep: `pmset -g log` shows `Clamshell Sleep`.

`caffeinate -s` (`PreventSystemSleep`) does keep a closed lid awake, **but only on AC power**. On battery the assertion is ignored.

The only switch that keeps a closed lid awake on battery is `pmset -a disablesleep 1` (`SleepDisabled`). It needs root, and **it survives a reboot**. Forget to turn it back off, and the Mac never sleeps again: not in your bag, and not from the Apple menu either. lid-awake exists to turn it on and make sure it gets turned back off.

With an external display, power and a keyboard connected, macOS clamshell mode already stays awake. You do not need this tool for that.

## How it works

```
you ── on ──► user loop (no root)                         root guard (sudo, detached)
              • holds `caffeinate -s` (AC)                 • pmset -a disablesleep 1
              • checks cap, battery, heat,                 • every 10s: loop alive? cap? battery < min?
                guard alive, every 30s                       thermal pressure heavy?
              • turns the panel off on lid close           • any "no" → disablesleep 0 and exit
              • writes ~/Library/Logs/lid-awake.log        • logs to syslog only
```

* `off`, the cap, low battery, heavy thermal pressure, a crashed loop or a killed guard each end the hold. Whichever side notices first stops. The guard's exit trap puts `disablesleep` back to 0.
* The hold does not depend on any app. A Claude session sitting at a permission prompt keeps the Mac awake too.
* View the guard's log: `log show --last 1d --predicate 'eventMessage CONTAINS "lid-awake"'`.

### Security design

* **Small root surface.** Root runs only a fixed zsh snippet embedded in the script (`zsh -f`, no rc files). It has a fixed `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`) and `cd /`. It reads no user-writable file. Its three arguments (loop pid, battery %, end time) are re-validated as digits inside the guard. A bad value falls back to the one that ends the hold, and the end time is capped at 72h whatever the caller passes.
* **Detached from sudo.** The guard is started in the background, and sudo (or the `--gui` dialog) returns right away. The user-level side therefore cannot reach it with signals relayed through sudo. It exits through its reset trap on INT/TERM/QUIT/USR1/USR2/ALRM/PIPE/XCPU/XFSZ. It ignores HUP, so closing the Terminal window does not end the hold, and it ignores TSTP, so it cannot be paused while holding.
* **Fail-safe parsing.** Every value from `pmset`/`notifyutil` that feeds arithmetic must be digits. If it is not, battery reads as 0% and thermal as "heavy", and the hold ends. The battery is read from the `InternalBattery` line only, so a UPS at 100% cannot hide a laptop battery at 8%.
* **One `on` at a time.** A lock directory stops two `on` runs from racing into two loops and two guards. `on` also fails clearly when `sudo -n` cannot reuse the ticket it just got (for example, `timestamp_timeout=0`).
* **`--gui` passes data, not code, to AppleScript.** The root command and the dialog text reach `osascript` as arguments (`on run argv`), never spliced into AppleScript source. `do shell script` runs `/bin/sh` with a fixed `PATH`, and the guard snippet is single-quoted (`${(qq)…}`).
* **Marker for the boot reset.** The guard creates `/var/db/lid-awake.active` (root-only) when it sets the flag, and removes it when it resets. `boot-reset` resets only when that marker is present, so a `SleepDisabled=1` an admin set on purpose is left alone.
* **No pid trust.** `off`, `status` and the guard only accept a pid whose command line carries the loop's marker. A stale or edited pid file cannot make `off` kill some other process.
* **Leftover detection.** `on` refuses to start if `SleepDisabled=1` is already set (left over from a reboot, a crash, or another tool). It also refuses to report success unless the guard process is running and the flag is set. `status` warns about a leftover. The fixed `PATH` and `/usr/bin/sudo` keep a planted `sudo`/`pmset`/`grep` earlier in your `PATH` out of the picture.

## Test evidence

MacBook Pro M3 Max, macOS 27, on battery, iPhone hotspot, FortiClient VPN, a probe every few seconds (internet + VPN + RDP host):

| Run | Lid closed | Samples | Failed | Largest gap | `pmset -g log` |
|---|---|---|---|---|---|
| 1 | 5 min | 52 | 0 | 6 s | no Sleep entry |
| 2 | 15.5 min | 177 | 0 | – | no Sleep entry; battery stayed at 100% (display reading), no heat |

On the same Mac, Claude Desktop's keep-awake setting alone produced `Clamshell Sleep` with the lid closed.

These tests used the original script that this release was cut from. The release adds hardening that has **not yet been run on a real Mac**: the sudo-detached guard, guard-alive checks, `boot-reset`, refusal on a leftover flag, and `displaysleepnow` on lid close. The guard logic itself was exercised with `pmset` stubbed out. See the checklist in [TESTING.md](TESTING.md).

## Compared with Amphetamine

[Amphetamine](https://apps.apple.com/app/amphetamine/id937984704) is a polished, free menu-bar app with triggers, schedules and a GUI. If you want a GUI, use it. Its closed-display mode relies on the same underlying `SleepDisabled` flag. Its own support page says a crash or force-quit during a closed-display session can leave the Mac unable to sleep, and recommends installing *Amphetamine Enhancer* as the fail-safe for that case.

| | lid-awake | Amphetamine closed-display mode |
|---|---|---|
| Install | one script, nothing resident | App Store app (+ Enhancer for the fail-safe) |
| Root | `sudo` once per `on`, you type it | through Enhancer's helper |
| Battery on a closed lid | yes, with a battery floor | yes (Apple Silicon has had power-source-change issues, addressed in 5.3+ per its changelog) |
| Ends on heat / low battery | yes, enforced by the root side | battery threshold: yes; heat: not that we know of |
| Crash / reboot leftover | guard reset trap; `status` warns; optional `boot-reset` | Enhancer fail-safe |
| Auditable | ~170 lines of zsh | closed source |
| GUI, schedules, triggers | no | yes |

We have not tested Amphetamine on the same hardware. The comparison is based on its documentation and changelog.

## Risks

Read these before you use it in a bag.

* **An awake, locked Mac keeps its FileVault keys in memory.** A sleeping Mac with "destroy FileVault key on standby" or hibernate keeps them out. A stolen laptop that is awake and locked is a better target (DMA/cold-boot class attacks, and any network service you left listening) than one that is asleep or off. Wi-Fi stays up. If that matters to you, do not leave it unattended.
* **Heat in a closed bag.** A closed MacBook under load, in a bag, has little airflow. The guard ends the hold on *heavy* thermal pressure, and macOS throttles before that, but "heavy" is a late signal. Idle or light work is fine. A long compile or a model run in a padded bag is not.
* **Battery.** Default floor 15% (lowest allowed 10%), default cap 12h. Pick shorter values for a bag (`--hours 3 --min-batt 30`). The floor is what makes it sleep. Do not count on macOS to hibernate cleanly at 0% while sleep is disabled.
* **The cap is wall-clock time.** Setting the clock back extends it. The battery floor and heat checks still apply.
* **`SleepDisabled` survives a reboot.** If the Mac restarts mid-hold (update, panic, hard power-off), nothing resets it until you run `off`, and Apple-menu Sleep does nothing meanwhile. `status` warns about it. `boot-reset install` fixes it at every boot by adding a root LaunchDaemon (`/Library/LaunchDaemons/local.lid-awake.boot-reset.plist`, fixed arguments, no script behind it). Endpoint security tools may flag a new LaunchDaemon as persistence. That is expected, and `boot-reset uninstall` removes it.
* **Do not mix it with other tools that toggle `SleepDisabled`.** When one of them ends, it resets the flag for all of them. `on` refuses to start while the flag is already set.
* **`SleepDisabled` is system-wide**, so it affects every user on the Mac. Managed (MDM) Macs may block or flag it.
* **While it holds, you cannot sleep the Mac by hand.** Run `off` first.
* **`--gui` asks for your admin password in a dialog the script raises.** That is convenient, and it is also a habit attackers rely on. The dialog text is set by the script, so a modified copy could show the same text and run something else. Only type the password when you just clicked lid-awake yourself.

## Touch ID (optional)

lid-awake asks for Touch ID by itself on any Mac where Touch ID is enabled for `sudo`; otherwise it shows macOS's password dialog. macOS ships this switch off. To turn it on, run this once in Terminal yourself (it asks your password one last time):

```bash
sed 's/^#auth/auth/' /etc/pam.d/sudo_local.template | sudo tee /etc/pam.d/sudo_local
```

This is Apple's own mechanism (macOS 14 and later; `sudo_local` survives macOS updates). It applies to **every** `sudo` on the Mac, not only lid-awake. To check: `sudo -k; sudo true` asks for your finger. To undo: `sudo rm /etc/pam.d/sudo_local`. With the lid closed, or an external keyboard without Touch ID, it falls back to the password.

## Instructions for Claude

You are installing this mod for the person who gave you this repository's link. Take `<owner>/<repo>` from that link.

1. **Check the Mac.** `uname -s` must print `Darwin`, and `ioreg -r -k AppleClamshellState -d 1 | grep -q AppleClamshellState` must succeed (a MacBook). Otherwise tell the person it does not fit (see [Requirements](#requirements)) and stop.
2. **Tell them, and ask.** In a few lines: a chip beside the model picker keeps the Mac awake with the lid closed, on battery too, until they turn it off. It ends by itself at the end time (12h), at 15% battery, or on heavy heat. Each turn-on asks for admin rights (Touch ID or password). Mention the two main [Risks](#risks): an awake, locked Mac keeps its FileVault keys in memory, and heat in a closed bag. Ask which language they want (`en` or `he`), how many hours a click should keep it awake (1 to 72, 12 if they have no preference; they can pick another duration each time from `/lid-awake`), and whether to install. Install nothing without their yes.
3. **Install.** `claude plugin install lid-awake --marketplace <owner>/<repo> --config language=<en|he> --config hours=<1-72>`. If `claude` is not on the PATH (as in some desktop app sessions), give them the steps instead: **+** next to the prompt box, **Plugins**, **Add marketplace** with `<owner>/<repo>`, **Add plugin** `lid-awake`, then `/plugin configure lid-awake@lid-awake` for the language and the hours.
4. **Check it.** `claude plugin list` shows `lid-awake@lid-awake` enabled. Tell them to run `/reload-plugins` (or open a new session), and that the chip `☾ Lid: sleep` appears beside the model picker.
5. **Do not** run `sudo`, `lid-awake.sh on`, `on --gui` or `boot-reset` for them, and do not edit `/etc/pam.d` or sudoers to add Touch ID. Turning it on is their click and their approval. Point them to `boot-reset` in [Risks](#risks) if they want a reset at every boot. That one they run themselves.
6. **Touch ID.** Check with `grep -qE '^[[:space:]]*auth[[:space:]]+sufficient[[:space:]]+pam_tid\.so' /etc/pam.d/sudo_local`. If that fails, tell them the chip will ask for their password in a dialog, and offer Touch ID instead: give them this command to run themselves, in Terminal (or after `!` at the Claude Code prompt), and say it turns on Touch ID for **every** `sudo` on the Mac, and that `sudo rm /etc/pam.d/sudo_local` undoes it:

   ```bash
   sed 's/^#auth/auth/' /etc/pam.d/sudo_local.template | sudo tee /etc/pam.d/sudo_local
   ```

   Do not run it for them (it changes how the Mac authenticates). Afterwards `sudo -k; sudo true` should ask for their finger, and so will the chip.

To remove it: `claude plugin uninstall lid-awake@lid-awake`, then the [Uninstall](#uninstall) steps.

## Uninstall

`./lid-awake.sh off`, `./lid-awake.sh boot-reset uninstall` (if installed), then delete the script, `~/Library/Application Support/lid-awake` and `~/Library/Logs/lid-awake.log`.

## License

MIT. See [LICENSE](LICENSE).

---

<div dir="rtl">

## עברית

**lid-awake** משאיר MacBook ער עם מכסה סגור, **גם על סוללה**, עד שאתם מכבים. אחר כך הוא מחזיר אותו לישון. זה סקריפט zsh אחד, בלי אפליקציה ובלי תוסף קרנל, ולא נשאר אחריו כלום מותקן.

הוא נכתב כדי שעבודה ארוכה תמשיך גם כשהמחשב בתיק: ‏Claude Desktop שעובד על משימה, ‏VPN, הורדה.

### שימוש

<div dir="ltr">

```bash
./lid-awake.sh on        # סיסמת sudo פעם אחת; מטען וסוללה, עד 12 שעות, משחרר ב-15%
./lid-awake.sh off       # כשחוזרים
./lid-awake.sh status
```

</div>

- `on --ac-only`: בלי sudo. מחזיק רק כשהמחשב מחובר לחשמל.
- `--gui`: ‏Touch ID (אם הוגדר ל-sudo) או חלון הסיסמה של macOS, במקום sudo בטרמינל. זה מה שהכפתור מריץ.
- **כמוד ל-Claude:** ה-repo הוא גם תוסף. הוא מוסיף תווית קטנה ליד בחירת המודל, וצבע התווית מראה את המצב: אפור כשכבוי, ירוק עם שעת הסיום כשפעיל, ואדום כשנשאר דלוק. לחיצה אחת מדליקה או מכבה, ו-`/lid-awake` פותח חלונית עם הפרטים. השפה נקבעת בהגדרה `language` (‏`en` או `he`). התקנה: `/plugin install lid-awake --marketplace itamar-cloud247/lid-awake`. המוד עצמו לא מריץ כלום כ-root.
- **לכמה זמן:** לחיצה על התווית מפעילה לפי ההגדרה `hours`. ברירת המחדל היא 12 שעות, ואפשר לבחור כל מספר שלם מ-1 עד 72. ב-`/lid-awake` יש בחירה מהירה (1, 2, 4, 8, 12 או 24 שעות) ושדה למספר שעות אחר.
- **התקנה דרך Claude:** נותנים ל-Claude את הקישור ל-repo ואומרים לו: "תתקין לי את המוד lid-awake מהקישור הזה". הוא בודק שהמחשב מתאים, מסביר מה המוד עושה, ושואל באיזו שפה ולכמה שעות. הוא מתקין רק אחרי אישור. אם Touch ID לא מופעל ל-sudo, הוא נותן את הפקודה להפעלה, אבל לא מריץ אותה בעצמו. את האישור בכל הדלקה (Touch ID או סיסמה) נותנים בעצמכם.
- **Touch ID:** הכלי משתמש ב-Touch ID מעצמו בכל Mac שבו Touch ID מופעל ל-sudo. בכל Mac אחר נפתח חלון הסיסמה. כדי להפעיל, מריצים פעם אחת בטרמינל `sed 's/^#auth/auth/' /etc/pam.d/sudo_local.template | sudo tee /etc/pam.d/sudo_local`. זה חל על **כל** פקודת sudo ב-Mac, לא רק על הכלי. ביטול: `sudo rm /etc/pam.d/sudo_local`.
- **דרישות:**
  - MacBook. במחשב בלי מכסה התווית מוסתרת.
  - macOS. נבדק על macOS 27 ב-M3 Max. על Intel ועל גרסאות ישנות לא נבדק.
  - הרשאות מנהל.
  - מחשב שהארגון לא חוסם בו את `pmset disablesleep` (MDM).
  - בשביל המוד: Claude Code בגרסה 2.1.309 ומעלה.
- `state`: שורה אחת לווידג'ט.
- `--until-idle`: משחרר 10 דקות אחרי ש-Claude Desktop מפסיק לעבוד.
- `--hours` ו-`--min-batt`: מגבלת זמן ורצפת סוללה (10%–90%).

תקראו את הסקריפט לפני שאתם מריצים אותו עם sudo. תשמרו אותו במקום שרק אתם יכולים לכתוב בו: מה שיש בקובץ ירוץ כ-root בפעם הבאה שתקלידו סיסמה.

### למה ההגדרה של Claude Desktop ו-`caffeinate` לא מספיקים

- **שינה בחוסר פעילות:** ההגדרה keep awake של Claude Desktop ורוב אפליקציות ה"ער" מונעות רק אותה. היא עובדת כשהמכסה פתוח.
- **סגירת מכסה:** זו שינה אחרת, והיא מתעלמת מהן. בבדיקה, עם ההגדרה דלוקה, המחשב נרדם (`Clamshell Sleep` ב-`pmset -g log`).
- **`caffeinate -s`:** מחזיק מכסה סגור, אבל **רק על מטען**.
- **על סוללה:** הדבר היחיד שעובד הוא `pmset -a disablesleep 1`. הוא דורש root, ו**נשאר גם אחרי Restart**. הכלי קיים כדי להדליק אותו, ולוודא שהוא יכבה.

### איך זה עובד

- **לולאה ברמת המשתמש:** מחזיקה את `caffeinate -s`.
- **שומר root קטן:** מנותק מ-sudo. הוא מדליק את `disablesleep`, ומכבה אותו כש:
  - הלולאה נעלמה (`off` או קריסה),
  - עברה מגבלת הזמן,
  - הסוללה מתחת לרצפה,
  - יש עומס חום כבד.
- **השומר מוגבל:** `PATH` קבוע, לא קורא שום קובץ שהמשתמש יכול לכתוב, ובודק מחדש את הקלט שלו. ערך לא תקין הופך לערך שמשחרר את ההחזקה, והזמן מוגבל ל-72 שעות.

### הוכחות מבדיקה

MacBook Pro M3 Max, על סוללה, נקודה חמה מאייפון, ו-FortiClient VPN:

| ריצה | מכסה סגור | דגימות | נכשלו | הפער הגדול ביותר | Sleep ב-`pmset -g log` |
|---|---|---|---|---|---|
| 1 | 5 דק' | 52 | 0 | 6 ש' | אין |
| 2 | 15.5 דק' | 177 | 0 | – | אין. הסוללה נשארה על 100%, בלי עומס חום |

הבדיקות נעשו בגרסה המקורית. החיזוקים שנוספו בגרסה הזו עוד לא נבדקו ב-Mac אמיתי (ראו [TESTING.md](TESTING.md)).

### מול Amphetamine

- **Amphetamine:** אפליקציה חינמית ומצוינת עם ממשק גרפי. גם מצב closed-display שלה נשען על אותו `SleepDisabled`. לפי התמיכה שלה, קריסה באמצע יכולה להשאיר את המחשב בלי שינה, ולכן הם ממליצים להתקין Amphetamine Enhancer כ-fail-safe.
- **lid-awake:**
  - סקריפט קצר שאפשר לקרוא.
  - לא נשאר מותקן.
  - נעצר בחום כבד ובסוללה נמוכה, והאכיפה בצד ה-root.
  - **אין לו** ממשק, תזמונים או טריגרים.
- **לא בדקנו את Amphetamine על אותה חומרה.**

### סיכונים

- **מחשב ער ונעול מחזיק את מפתחות FileVault בזיכרון.** מחשב גנוב שער הוא מטרה טובה יותר ממחשב ישן או כבוי. גם ה-Wi-Fi נשאר מחובר.
- **חום בתיק סגור:** עבודה קלה בסדר. עבודה כבדה בתיק מרופד לא. השומר עוצר רק בעומס חום **כבד**, שהוא סימן מאוחר.
- **סוללה:** לתיק מומלץ `--hours 3 --min-batt 30`.
- **`SleepDisabled` נשאר אחרי Restart.** עד שמריצים `off`, המחשב לא ישן, גם לא מתפריט Apple.
  - `status` מזהיר על זה.
  - `boot-reset install` מאפס בכל הפעלה, עם LaunchDaemon קטן, ורק אם lid-awake הוא שהדליק את הדגל. כלי EDR עלולים לסמן אותו כ-persistence.
- **`--gui`:** מקלידים סיסמה רק כשאתם בעצמכם לחצתם על lid-awake עכשיו. את הטקסט בחלון קובע הסקריפט.
- **לא לשלב** עם כלים אחרים שמשנים את `SleepDisabled`.

</div>
