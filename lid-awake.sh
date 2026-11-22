#!/bin/zsh -f
# lid-awake: keep a MacBook awake with the lid closed, on AC or battery, until you turn it off.
#   ./lid-awake.sh helper install          # once, in a terminal (sudo): installs the root guard; then `on` needs no password
#   ./lid-awake.sh on                      # holds until `off` (cap 12h), no prompt
#   ./lid-awake.sh on --hours 4 --min-batt 20    # --hours in half hours: 0.5 to 72 (1.5 = an hour and a half)
#   ./lid-awake.sh on --ac-only            # no sudo: AC only; unplugged + lid closed sleeps as usual
#   ./lid-awake.sh on --ac-only --until-idle   # ...and let go 10 min after Claude Desktop stops working
#   ./lid-awake.sh off | status | state     # state: one line for a menu-bar/status widget
#   --gui is accepted and ignored (older plugin versions pass it)
#   ./lid-awake.sh boot-reset install|uninstall   # optional: reset SleepDisabled to 0 at every boot (sudo)
# How: a user loop holds `caffeinate -s` (PreventSystemSleep, honoured on AC only). Plain `on` also starts a small root
# guard (the root-owned helper, through sudo -n) that sets `pmset -a disablesleep 1`, the only thing that keeps a closed lid awake on battery, and puts it
# back to 0 as soon as the loop is gone (`off`, cap, crash), the battery is under --min-batt, or thermal pressure is
# heavy. disablesleep survives a reboot: `status` warns about a leftover, `off` clears it, `boot-reset install` clears
# it at boot. With an external display + power + keyboard, macOS clamshell mode already stays awake without this.
set -u
umask 077
SELF=$0 ME=${0:t}         # captured here: inside a function $0 is the function name
PATH=/usr/bin:/bin:/usr/sbin:/sbin   # fixed, so nothing in the user's PATH can stand in for pmset/ps/sudo
STATE="$HOME/Library/Application Support/lid-awake"
PIDF="$STATE/loop.pid"
LOG="$HOME/Library/Logs/lid-awake.log"
INFO="$STATE/loop.info"              # "<end epoch> <ac_only>" while the loop runs, for `state`
TAG=__lid_awake_loop                 # the loop's argv marker; `off`, `status` and the guard only trust a pid that has it
BOOT_LABEL=local.lid-awake.boot-reset
BOOT_PLIST=/Library/LaunchDaemons/$BOOT_LABEL.plist
MARK=/var/db/lid-awake.active        # root-only: the guard creates it with disablesleep 1 and removes it with 0
RESET="/usr/bin/pmset -a disablesleep 0; /bin/rm -f $MARK"
# Root helper (22/11/2026): when installed root-owned with its sudoers rule (`helper install`), the guard runs from
# there through `sudo -n`, with no password prompt and no code from this (user-writable) file running as root.
HELPER=/usr/local/libexec/lid-awake/lid-awake-guard
MINUTES=720 MIN_BATT=15 ACONLY=0 UNTIL_IDLE=0 GRACE=10 GUI=0
mkdir -p "$STATE" "${LOG:h}"

running() { [[ -f $PIDF && $(<$PIDF) == <-> ]] && ps -p "$(<$PIDF)" -o command= 2>/dev/null | grep -qF -- " $TAG " }
guard_alive() { pgrep -u root -f -- "lid-awake-guard (run )?$1 " >/dev/null }
# The helper counts only if root owns it and every folder above it, none writable by group/others, and the sudoers rule
# lets us run it without a password. Otherwise the older admin-prompt path is used.
root_only() { local p=$1 m; while [[ $p != / ]]; do
  [[ -e $p && ! -L $p && $(stat -f %u "$p") == 0 && -z $(ls -led "$p" | sed 1d) ]] || return 1
  m=$(stat -f %Lp "$p"); (( (8#$m & 8#22) == 0 )) || return 1; p=${p:h}; done }
helper_ok() { [[ -f $HELPER ]] && root_only $HELPER && /usr/bin/sudo -n -l $HELPER reset >/dev/null 2>&1 }
log() { print -r -- "$(date '+%F %T') $*" >> "$LOG" }
# Values that feed (( )) are digits only; anything unreadable falls back to the value that releases the hold.
num() { [[ $1 == <-> ]] && print $1 || print $2 }
on_ac() { pmset -g batt | head -1 | grep -q "AC Power" }
batt() { num "$(pmset -g batt | grep InternalBattery | grep -oE '[0-9]+%' | head -1 | tr -d %)" 0 }   # not a UPS line
has_lid() { ioreg -r -k AppleClamshellState -d 1 | grep -q '"AppleClamshellState"' }   # MacBooks only
lid() { ioreg -r -k AppleClamshellState -d 1 | grep -q '"AppleClamshellState" = Yes' && print closed || print open }
thermal() { num "$(notifyutil -g com.apple.system.thermalpressurelevel | awk '{print $2}')" 9 }   # 0 nominal, 1 moderate, 2 heavy+
sleep_disabled() { pmset -g | grep -qE '^ *SleepDisabled[[:space:]]+1' }
claude_busy() { pmset -g assertions | grep -qE 'pid [0-9]+\(Claude\).*NoIdleSleepAssertion' }
notify() { osascript -e 'on run argv' -e 'display notification (item 1 of argv) with title "lid-awake"' -e 'end run' "$1" >/dev/null 2>&1 }
usage() { print "usage: $ME on [--hours N] [--min-batt P] [--ac-only [--until-idle]] | off [--gui] | status | state | boot-reset install|uninstall | helper install|uninstall"; exit 2 }

# Since 22/11/2026 lid-awake never asks for an admin password or Touch ID: the root part is lid-awake-guard, installed
# root-owned (`helper install`) and run through `sudo -n`. A lid-awake prompt for admin rights therefore means the script
# was changed by someone else: refuse it. Without the helper only --ac-only works.
NOHELPER="the root helper is not installed: run '$ME helper install' once in a terminal, or use 'on --ac-only'"

case "${1:-}" in
  off|stop)
    [[ ${2:-} == --gui ]] && GUI=1
    running && { kill "$(<$PIDF)"; print "stopped" } || print "not running"
    if sleep_disabled; then
      sleep 12   # the guard checks every 10s and puts disablesleep back itself
      if sleep_disabled; then
        print "SleepDisabled is still 1 (guard gone?), resetting:"
        helper_ok || { print "$NOHELPER; or reset by hand: sudo pmset -a disablesleep 0"; exit 1 }
        /usr/bin/sudo -n $HELPER reset; sleep 1
        ! sleep_disabled || { print "reset FAILED: run 'sudo pmset -a disablesleep 0'"; exit 1 }
      fi
    fi
    exit 0 ;;
  status)
    if running; then
      lp=$(<$PIDF); print "running (pid $lp)"
      guard_alive $lp && print "root guard: running" || print "root guard: none (AC-only mode, or it ended)"
    else print "not running"; fi
    sleep_disabled && print "SleepDisabled=1 (a closed lid stays awake on battery too)"
    ! running && sleep_disabled && print "WARNING: SleepDisabled=1 with no loop (reboot or crash during a hold?): run '$ME off'"
    [[ -e $MARK ]] && print "marker $MARK: set (lid-awake set SleepDisabled=1)"
    [[ -f $BOOT_PLIST ]] && print "boot-reset: installed" || print "boot-reset: not installed"
    helper_ok && print "root helper: installed ($HELPER, no password)" || print "root helper: not installed (admin prompt each time; '$ME helper install')"
    pmset -g assertions | grep -E 'caffeinate|Claude'; tail -5 "$LOG" 2>/dev/null; exit 0 ;;
  state)   # one line: on|off <SleepDisabled 0|1> <until HH:MM|-> <full|ac|-> <lid|nolid>
    if running; then
      e=0 a=0; [[ -f $INFO ]] && read -r e a < "$INFO"
      print "on $(sleep_disabled && print 1 || print 0) $([[ $e == <1-> ]] && date -r $e '+%H:%M' || print -- -) $([[ $a == 1 ]] && print ac || print full) $(has_lid && print lid || print nolid)"
    else print "off $(sleep_disabled && print 1 || print 0) - - $(has_lid && print lid || print nolid)"; fi
    exit 0 ;;
  boot-reset)
    case "${2:-}" in
      install)
        # A one-shot root job with fixed arguments and no user-writable file behind it. It resets only when the root-only
        # marker says lid-awake set the flag, so a SleepDisabled=1 set on purpose by an admin is left alone. Loaded
        # only at the next boot, so installing it does not end a hold that is running now.
        tmp=$(mktemp) || exit 1
        print -r -- '<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>'$BOOT_LABEL'</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>[ -f '$MARK' ] &amp;&amp; { '$RESET'; }</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>' > "$tmp"
        plutil -lint "$tmp" >/dev/null || { rm -f "$tmp"; exit 1 }
        /usr/bin/sudo /usr/bin/install -m 644 -o root -g wheel "$tmp" "$BOOT_PLIST"; rc=$?
        rm -f "$tmp"; (( rc )) || print "installed $BOOT_PLIST (runs at every boot)"; exit $rc ;;
      uninstall)
        /usr/bin/sudo /bin/launchctl bootout system/$BOOT_LABEL 2>/dev/null
        /usr/bin/sudo /bin/rm -f "$BOOT_PLIST" && print "removed $BOOT_PLIST"; exit 0 ;;
      *) usage ;;
    esac ;;
  helper)
    # Installs the root guard and a sudoers rule for exactly its two forms. Run it yourself in a terminal: it asks for
    # sudo once. This file and the guard beside it are user-writable, so install only from a reviewed tree, then check
    # the installed (root-owned, so it cannot change afterwards) guard's hash against GitHub and read `sudo -n -l`.
    # The root shell writes the sudoers line itself, checked by visudo before it is used.
    case "${2:-}" in
      install)
        src=${SELF:A:h}/lid-awake-guard; [[ -f $src ]] || { print "missing $src"; exit 1 }
        user=$(id -un); [[ $user =~ '^[a-z_][a-z0-9_.-]*$' ]] || { print "unexpected user name"; exit 1 }
        /usr/bin/sudo /bin/zsh -f -c '
          PATH=/usr/bin:/bin:/usr/sbin:/sbin; umask 022; set -e
          d=/usr/local/libexec/lid-awake h=$d/lid-awake-guard
          for p in /usr /usr/local /usr/local/libexec; do
            [[ -d $p && ! -L $p && $(stat -f %u $p) == 0 && -z $(ls -led $p | sed 1d) ]] && (( (8#$(stat -f %Lp $p) & 8#22) == 0 )) ||
              { print "unsafe or missing folder $p"; exit 3 }
          done
          install -d -o root -g wheel -m 755 $d
          install -o root -g wheel -m 755 "$1" $h.new || exit 5
          mv -f $h.new $h || exit 5
          [[ -d /etc/sudoers.d ]] || install -d -o root -g wheel -m 755 /etc/sudoers.d
          t=$(mktemp /etc/sudoers.d/.lid-awake.XXXXXX)
          print -r -- "$2 ALL=(root) NOPASSWD: $h start *, $h reset" > $t
          chmod 440 $t; chown root:wheel $t
          visudo -cf $t >/dev/null || { rm -f $t; print "sudoers check failed"; exit 4 }
          mv -f $t /etc/sudoers.d/lid-awake
          print "installed $h"' lid-awake-install "$src" "$user" || exit 1
        print "check it yourself now, in a new command: shasum -a 256 $HELPER ; sudo -n -l"
        helper_ok && print "helper OK: lid-awake now starts the guard with no password prompt" ||
          { print "helper NOT usable (check: sudo -l)"; exit 1 }
        exit 0 ;;
      uninstall)
        /usr/bin/sudo /bin/rm -f /etc/sudoers.d/lid-awake $HELPER && /usr/bin/sudo /bin/rmdir ${HELPER:h} 2>/dev/null
        print "removed the helper and its sudoers rule"; exit 0 ;;
      *) usage ;;
    esac ;;
  $TAG) shift ;;
  on|start|"")
    (( $# )) && shift
    while (( $# )); do case $1 in
      --hours)    # whole or half hours (4, 1.5, 0.5), turned into minutes here so (( )) only ever sees digits
                  [[ ${2:-} == (<0-72>|<0-72>.0|<0-71>.5) ]] || { print -r -- "--hours: 0.5 to 72, in half hours (1.5 = an hour and a half)"; exit 2 }
                  MINUTES=$(( ${2%%.*} * 60 )); [[ $2 == *.5 ]] && (( MINUTES += 30 ))
                  (( MINUTES >= 30 && MINUTES <= 4320 )) || { print -r -- "--hours: 0.5 to 72"; exit 2 }; shift ;;
      --min-batt) [[ ${2:-} == <10-90> ]] || { print -r -- "--min-batt: 10-90"; exit 2 }; MIN_BATT=$2; shift ;;
      --ac-only)  ACONLY=1 ;;
      --until-idle) UNTIL_IDLE=1 ;;
      --gui)      GUI=1 ;;
      *) usage ;;
    esac; shift; done
    # One `on` at a time: without this, two runs at once could both pass `running` and leave an orphan loop.
    mkdir "$STATE/on.lock" 2>/dev/null || { print "another '$ME on' is starting (or remove $STATE/on.lock)"; exit 1 }
    trap 'rmdir "$STATE/on.lock" 2>/dev/null' EXIT
    has_lid || { print "this Mac has no lid: nothing to keep awake when it closes ('caffeinate -s' keeps a desktop Mac awake)"; exit 1 }
    running && { print "already running (pid $(<$PIDF)); '$ME off' first to change options"; exit 0 }
    # A SleepDisabled=1 left by a reboot or crash would keep the lid awake on battery with no guard watching it.
    sleep_disabled && { print "SleepDisabled=1 is left over from an earlier run; '$ME off' first"; exit 1 }
    HOK=0; (( ACONLY )) || ! helper_ok || HOK=1
    (( ACONLY || HOK )) || { print "$NOHELPER"; exit 1 }
    end=$(( $(date +%s) + MINUTES * 60 ))
    nohup /bin/zsh -f "$SELF" $TAG $end $MIN_BATT $ACONLY $UNTIL_IDLE >/dev/null 2>&1 &
    lpid=$!; print $lpid > "$PIDF"   # nohup execs zsh, so this is the loop's own pid
    if (( ! ACONLY )); then
      sleep 1
      /usr/bin/sudo -n $HELPER start $lpid $MIN_BATT $end ||
        { kill $lpid; print "the root helper refused to start (see: log show --last 5m --predicate 'eventMessage CONTAINS \"lid-awake\"')"; exit 1 }
      for i in {1..10}; do guard_alive $lpid && sleep_disabled && break; sleep 1; done
      guard_alive $lpid && sleep_disabled || { kill $lpid; print "guard did not start, stopped"; exit 1 }
    fi
    print "on until '$ME off' or $(date -r $end '+%H:%M'); $( (( ACONLY )) && print 'AC only' || print "AC + battery down to $MIN_BATT%"). log: $LOG"
    (( ACONLY )) || print "while on, Apple menu > Sleep does nothing: '$ME off' first"
    exit 0 ;;
  *) usage ;;
esac

# The loop. Its arguments come from `on` above; anything else falls back to values that end the hold.
end=$(num "${1:-}" 0) MIN_BATT=$(num "${2:-}" 100) ACONLY=$(num "${3:-}" 1) UNTIL_IDLE=$(num "${4:-}" 1)
print $$ > "$PIDF"; print "$end $ACONLY" > "$INFO"
idle_since=0 cpid=0 why="" last="" stop="" lidwas=open
release() { (( cpid )) && kill $cpid 2>/dev/null; cpid=0 }
bye() {
  release; log "exit${stop:+ ($stop)}"; rm -f "$PIDF" "$INFO"
  [[ -z $stop ]] && return
  # The guard notices within 10s that we are gone. Only say "will sleep" once the flag is really back to 0.
  for i in {1..15}; do sleep_disabled || break; sleep 1; done
  sleep_disabled && notify "Off: $stop. WARNING: SleepDisabled is still 1, run '$ME off'." ||
    notify "Off: $stop. A closed lid will sleep now."
}
trap bye EXIT
trap 'exit 0' INT TERM
log "start until=$(date -r $end '+%F %H:%M') min_batt=$MIN_BATT ac_only=$ACONLY until_idle=$UNTIL_IDLE"
# `on` starts the guard after us, and with --gui only once the password dialog is answered; it kills us if that fails.
(( ACONLY )) || for i in {1..180}; do guard_alive $$ && break; sleep 1; done
while :; do
  now=$(date +%s)
  if (( UNTIL_IDLE )); then
    if claude_busy; then idle_since=0; elif (( ! idle_since )); then idle_since=$now; fi
    (( idle_since && now - idle_since >= GRACE * 60 )) && { stop="Claude idle ${GRACE}m"; break }
  fi
  (( ! ACONLY )) && ! guard_alive $$ && { stop="root guard gone"; break }
  (( now >= end )) && { stop="cap reached"; break }
  (( $(thermal) >= 2 )) && { stop="thermal pressure $(thermal)"; break }
  if ! on_ac; then
    (( $(batt) < MIN_BATT )) && { stop="battery $(batt)% < $MIN_BATT%"; break }
    (( ACONLY )) && why="battery, AC-only mode" || why=""
  else why=""; fi
  if [[ -z $why ]]; then
    (( cpid )) && kill -0 $cpid 2>/dev/null || { caffeinate -s -w $$ & cpid=$! }
  else release; fi
  l=$(lid)
  # Some Apple Silicon setups keep the internal panel lit under a closed lid while sleep is disabled.
  [[ $l == closed && $lidwas == open && -z $why ]] && pmset displaysleepnow
  lidwas=$l
  cur="hold=$([[ -z $why ]] && print on || print "off ($why)") sleepdisabled=$(sleep_disabled && print 1 || print 0) lid=$l ac=$(on_ac && print 1 || print 0) batt=$(batt)% therm=$(thermal)"
  [[ $cur != $last ]] && { log "$cur"; last=$cur }
  sleep 30 & wait $!   # wait, not a foreground sleep, so `off` (TERM) is handled at once
done
