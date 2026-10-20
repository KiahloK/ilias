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
npm run build                # background sync (TypeScript → dist/)
npm run build:app            # menu bar app (SwiftUI → macos/build/ILIAS Sync.app), no Xcode needed
node dist/cli.js install     # both start now and at every login
node dist/cli.js uninstall   # remove both again
```

- **Background sync** (`watch`, LaunchAgent `de.ilias-sync.watch`): syncs at login, every 30 min
  and right after wake-up; restarted automatically if it crashes. Log: `~/Library/Logs/ilias-sync.log`.
- **Menu bar app** (`~/Applications/ILIAS Sync.app`): status, recent files, Sync now, Pause, and a
  Settings window for URL, account (password → Keychain), courses, folders, recordings and interval.
  Quitting it does not stop the background sync.
- The app talks to the background sync through a local API on `127.0.0.1`; its random port and key
  are in `~/.config/ilias-sync/daemon.json` (readable only by you).

After changing code: rebuild (`npm run build` / `npm run build:app`) and run `node dist/cli.js install` again.
