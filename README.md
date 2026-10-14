# ilias-sync

Mirrors selected ILIAS courses (built against ILIAS 9 at Uni Stuttgart) into local folders and keeps them up to date.

```bash
npm install
npm run dev -- setup              # login, pick courses + target folders (password goes to macOS Keychain)
npm run dev -- sync --dry-run     # show what would be downloaded
npm run dev -- sync               # one sync pass (--no-videos to skip recordings)
npm run dev -- watch              # keep running, check every 30 min (configurable: -i <minutes>)
npm run dev -- courses            # change course selection
```

- Config: `~/.config/ilias-sync/config.json`
- Per course, `.ilias-sync-state.json` remembers what was downloaded (ILIAS version/date/size).
- When a file changes on ILIAS, the old local copy is kept as `Name (YYYY-MM-DD).ext`.
- Sessions ("Sitzungen") are only checked once they have started.
- Exercises (Übungen): assignment sheets are downloaded (once; ILIAS shows no version info for them).
- Opencast lecture recordings are saved as `YYYY-MM-DD Title.mp4` (~500 MB each). Toggle per course in `setup`/`courses`, or skip once with `sync --no-videos`.
- Not synced: forums, weblinks, course links.

## Run automatically at login (macOS)

```bash
npm run build
node dist/cli.js install     # LaunchAgent: runs `watch` at login, restarts if it crashes
node dist/cli.js uninstall   # remove it again
tail -f ~/Library/Logs/ilias-sync.log
```

`watch` syncs at start, every 30 min, and right after the Mac wakes up. It re-reads the
config before every run, so `courses` changes apply without restarting. After changing the
code, run `npm run build` and `launchctl kickstart -k gui/$(id -u)/de.ilias-sync.watch`.
