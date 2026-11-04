# Agent Pulse

**English** | [简体中文](README.zh-CN.md)

A local desktop workspace for agent sessions: a pulse monitor for your AI agents, built with React, TypeScript and Electron.

The desktop app includes an **experimental, read-only VS Code / GitHub Copilot adapter**. It reads local Copilot transcript events and saved chat request state, checking active requests every two seconds with file-change wakeups and backoff for inactive history. The browser preview and the separate Demo source still use sample data. Claude Code and Codex are not connected yet.

## Run

Use Node.js 24 LTS or newer. The desktop application is currently tested on Windows.

```sh
npm install
npm run dev
```

Vite prints the browser preview URL and selects another port if its preferred port is occupied.

```sh
npm run desktop
```

This builds the interface and starts the desktop application. For desktop development with live reload:

```sh
npm run desktop:dev
```

## Windows installer

Build the x64 installer with:

```sh
npm run dist:win
```

The output is `release/Agent-Pulse-Setup-<version>-x64.exe`. It installs for the current user without requiring administrator elevation, offers an installation-directory choice, and creates desktop and Start menu shortcuts. The application executable, native windows and shortcuts use the Pulse icon. Uninstall keeps local app data by default.

This development installer is unsigned, so Windows may display an unknown-publisher or SmartScreen warning. Code signing remains future work; do not disable Windows security protections to install an untrusted build. Only Windows x64 is packaged by this command.

Quit the running development copy from the tray before starting the installed app; otherwise the single-instance lock can reactivate the old `electron.exe` process. If Windows has an old Electron shortcut pinned, unpin that shortcut and pin the installed Agent Pulse app instead. The development command still runs Electron's generic executable, even though its window icon is configured.

The installer includes `resources/companion/pulse-companion.vsix` under the chosen installation directory. Install this file explicitly through VS Code's **Extensions: Install from VSIX** command for exact chat navigation; the desktop installer does not silently install or reload editor extensions. Existing Companion users do not need to reinstall it just for this desktop packaging change.

Generated release files are excluded from Git. The packaged app includes the compiled UI, Electron code, the bridge client and icon resources, not the development source, tests, local plan or build dependencies. The installer and packaged EXE were built and smoke-tested; the install/uninstall wizard was not executed on the development machine.

## Project website and releases

GitHub Pages hosts a short project introduction and a Windows download page. Binaries live in [GitHub Releases](https://github.com/liukun2634/agent-pulse/releases), not in Git or Pages. The download page looks up published releases, including previews; before the first release, or if the API is unavailable, it leaves download buttons disabled and provides a Releases link. Screenshots use only Demo data.

Build the static site locally:

```sh
npm run build:site
npm run test:site
```

The generated site is in `.artifacts/site/`; open its `index.html` in a browser. Source pages are in [site/](site/), with icons and local fonts added during the build. No application server is required.

To enable GitHub publishing:

1. In repository **Settings > Pages**, set **Source** to **GitHub Actions**. The repository and plan must support Pages; this site uses public, unauthenticated Releases downloads.
2. Push the workflow and site changes to `main`. **Deploy project website** builds only the site and publishes it at [liukun2634.github.io/agent-pulse](https://liukun2634.github.io/agent-pulse/). Later site changes deploy automatically; the workflow also supports manual dispatch.
3. When a version is ready, update the root package version and lockfile, commit and push those changes, then push a matching tag such as `v0.1.0`. **Build Windows release** rejects mismatched tags, runs tests, and builds the unsigned x64 installer on Windows. It publishes the EXE, Companion VSIX and `SHA256SUMS.txt` as release assets. All `0.x` and hyphenated prerelease versions are marked as previews. Pushing `main` alone never publishes an installer.
4. To try packaging without publishing, run **Build Windows release > Run workflow**. Download its `windows-release` artifact from the Actions run; these build artifacts expire after 14 days. The website lists Releases, not temporary Actions artifacts.

The **CI** workflow checks unit tests, lint, the application build and site browser tests on pull requests and `main`. Workflows use the built-in `GITHUB_TOKEN` with job-scoped permissions; no personal access token or signing secret is needed for the current unsigned build. Repository or organization policies may require allowing Actions and release writes. This configuration does not itself enable Pages or publish a release until the corresponding workflow runs. The application does not auto-update.

## VS Code source

The desktop app starts with VS Code selected. It discovers local workspace folders and saved `.code-workspace` workspaces under VS Code's user storage. On Windows the default is `%APPDATA%\Code\User\workspaceStorage`. Open the app alongside VS Code and look for your project, then use Mini monitor to keep it at the screen edge. Settings enables optional system notifications for input requests, finished replies and session errors.

The adapter reads `GitHub.copilot-chat/transcripts/*.jsonl` incrementally. It shows up to 100 recent transcript-backed sessions, with the latest 40 timeline events per session. Session IDs include the workspace identity. Matching `chatSessions/*.jsonl` records are also read incrementally for saved titles and the latest request state. A saved `customTitle`, when available, supplies the display title; otherwise a transcript user message or a generic label is used. Saved title changes are reflected on subsequent reads. Request state can supply completion, cancellation, error and input signals that are missing from the transcript.

Lightweight directory discovery and snapshot publication run every two seconds so newly created or removed sessions remain visible. **In progress, Needs input and unfinished No recent activity sessions keep a two-second check interval**, even after a long silence. Other sessions, including finished history, back off with inactivity: 2 seconds below 30 seconds idle, 5 seconds below 2 minutes, 15 seconds below 10 minutes, then 60 seconds. Changes in transcript or saved-chat directories wake the affected session on the next discovery tick. New transcript activity or a newer saved request restores fast checks. If filesystem notifications are unavailable or missed, bounded polling remains the fallback. Manual Refresh and switching to VS Code bypass the idle delay. Partial writes and unread backlog stay on fast polling. These are scheduling intervals, not a real-time guarantee; disk I/O and initial history loading can add latency.

Cards, the side monitor and session details display **Idle**, the time since the last observed transcript activity, updated every second without rereading the log. It continues to grow after a reply finishes and resets when a newer event arrives. This is not a claim that the agent is doing no work. **Elapsed** remains separately available in the details and freezes when the observed reply ends.

For VS Code Insiders, a portable installation or another user-data directory, set the storage root before launching. For example, in PowerShell:

```powershell
$env:PULSE_VSCODE_STORAGE = Join-Path $env:APPDATA 'Code - Insiders\User\workspaceStorage'
$env:PULSE_VSCODE_SCHEME = 'vscode-insiders'
npm run desktop
```

Only `vscode` and `vscode-insiders` URL schemes are supported. Missing or unreadable storage is shown explicitly; Pulse never substitutes demo sessions for a failed connection. VS Code versions that do not write this transcript format, untitled workspaces, remote-only workspace URIs and other providers are not supported by this adapter.

### Status semantics

| Status             | Evidence                                                                                                                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In progress        | A user message, assistant turn or tool event is active, or a newer saved request has started.                                                                                                                                                       |
| Needs input        | A known question tool, such as `vscode_askQuestions`, is pending, or the current saved request indicates input is needed.                                                                                                                           |
| Rely Ready         | A nonempty assistant reply without tool requests is followed by a turn end with no pending tools, or the current saved request records a successful finish. This means output is available, not that the session is archived or the task succeeded. |
| Failed             | An explicit `session.error` event, or a finished saved request marked with an error. A failed tool alone does not fail the session because the agent may recover.                                                                                   |
| Stopped            | The current saved request records cancellation.                                                                                                                                                                                                     |
| No recent activity | A previously running session has no new activity for two minutes and no completion signal. The agent may still be working.                                                                                                                          |
| Status unknown     | Incomplete lifecycle evidence or a partial log update. Silence never implies completion.                                                                                                                                                            |

These are inferred states from internal, version-dependent files, not an official Copilot lifecycle API or a VS Code process heartbeat. Some permission prompts, cancellations and final responses may not be recorded in either source. Missing completion signals may leave a session idle or unknown; an observed input request can remain waiting until a later update resolves it. Historical transcripts remain visible and are not necessarily open chats. Branch and file-change counts are not inferred, and elapsed time starts at the earliest observed transcript event.

**Open in VS Code uses the already-open workspace window through Pulse Companion 0.4.** It no longer launches a `vscode://file` URL before navigation. The companion focuses its own window, opens and identifies the target Chat tab, and waits for asynchronous confirmation when moving it into Chat view. Missing sidebar commands produce an editor fallback; connection errors never open a new window. Missing registration, a stale pipe, timeouts, missing sessions and navigation failures have separate messages. Focus the original VS Code window or run **Pulse: Show Connection Status** to refresh its registration. Reload VS Code after upgrading an already-active companion. No messages are submitted and no permissions are auto-approved.

Package and install the local companion from this repository:

```sh
npm --prefix vscode-companion run package
code --install-extension .artifacts/pulse-companion.vsix --force
```

Run **Pulse: Show Connection Status** in VS Code if the extension has not activated yet. The companion routes by workspace using an authenticated local pipe, not a public network listener. The current internal chat URI format was verified locally; compatibility with other VS Code versions is experimental. See [Pulse Companion](vscode-companion/README.md).

**State-change reminders** are detected in the Electron main process. A monitored session entering Needs input or producing output shows a compact notification at the top center of the display without taking keyboard focus. It fades after about five seconds; hovering pauses the timer. Changes in one batch share a notification instead of cycling through old pending alerts. Fading or closing the notification only hides it: it does not mark output as read, archive the session, or discard pending alerts. The toolbar bell can reopen them. A waiting alert clears when execution resumes. Pulse must remain running, including in the tray, for monitoring to continue.

OS notifications are an optional additional channel in Settings. They default to off to avoid duplicate banners; legacy notification preferences are reset to this quieter default once. Pulse's own top notification remains enabled, without taskbar flashing.

The bell, tray menu and notification's `+N more` action open a stable pending-reminder list, with input requests first. Each item can be opened or ignored independently; ignoring a reminder does not mark the reply read or archive its session. Navigation failures remain visible on the item. Existing input requests enter this list silently at startup, while historical completions do not create alerts. Up to 200 pending reminders and the recent deduplication baseline are saved atomically in the app's local user data. Restart restores pending items quietly without reviving dismissed input requests. Wake-from-sleep handling requests a fresh scan and suppresses a catch-up popup burst; physical suspend/resume compatibility still needs broader validation. Corrupt history is retained as a backup and recovery/write failures are shown in the reminder list.

Navigation carries a request reference. A stale reminder is rejected, and an older navigation receipt cannot clear a newer request's reminder or mark its reply read. New viewed-reply markers include the request identity and completion time, while older timestamp-only markers remain readable.

**Rely Ready and Archive session are separate.** Rely Ready is a provider lifecycle state for the latest reply. Archive session is a manual, reversible Pulse collection change. In live Workspace details, use Archive session or Restore session; the collection selector shows unarchived, archived or all sessions. Archive markers are persisted locally without changing provider status, timestamps, source files or monitoring. Active or actionable archived sessions can still appear in the mini monitor. The separate Replies ready section has been removed from Workspace; output status remains on session cards and in status filters. Viewed-reply markers remain separate from archive state.

Live snapshots stay in process memory and are not written to the demo cache. Reminder history stores only session/request identity, titles, workspace names, statuses and timestamps in local app data. No tool arguments, tool outputs or reasoning text are sent to the renderer. Titles, optional user-message task labels, workspace names and event summaries are local session information; enabling system notifications may expose project/task names on the OS notification surface. The adapter does not upload this data.

## Available interactions

- Switch between VS Code and Demo in the desktop workspace. Both native windows use the same source.
- Search and filter sessions by status and provider; switch grid and list layouts.
- Inspect the session timeline, task details, elapsed time and live idle duration.
- In Demo only, run a completion demo, approve a sample request, or retry a sample failure. These controls cannot mutate real sessions.
- Receive in-app completion alerts; optionally enable system notifications and sound in Settings.
- Minimize the native workspace, or click Mini monitor, to switch to a side monitor on the current display. The main window stays minimized with a taskbar entry; restoring it from the taskbar hides the mini monitor. Closing the workspace still hides it to the tray instead.
- Collapse the side monitor into a narrow task rail; switch between the left and right screen edges.
- Click a live task in either side-monitor layout to open it in VS Code. Demo tasks still restore their Pulse detail panel.
- Use Expand workspace to maximize the full panel; minimizing it returns to the side monitor.
- Both windows synchronize session state and preferences locally. Live source updates come from one Electron collector; demo changes use local storage. Alerts also appear in the side monitor while the main panel is hidden.
- Pin either native window above other windows. Browser windows cannot provide system-wide pinning.
- Drag the native mini monitor by its header. Its footer stays visible while sessions scroll.
- Close the native workspace to keep it in the tray. Use "Quit Pulse" in the tray menu to exit.

System notifications depend on OS notification settings. The browser preview asks for permission only when notifications are enabled. Browser popups must be allowed to open the mini monitor.

The browser preview can display both compact layouts, but cannot read local VS Code sessions or dock, maximize or pin OS windows. Switching modes in the native app controls real windows. Exact conversation navigation requires the native app and Pulse Companion.

Sample data and preferences are stored on the device. Reset demo restores the six sample sessions and is disabled for the VS Code source. No account, telemetry, external fonts or model API key is required.

## Checks

```sh
npm test
npm run test:e2e
npm run test:desktop
npm run build
npm run lint
```

Browser tests use Microsoft Edge on Windows and Playwright Chromium on other platforms. Install the matching browser before running the tests. `PULSE_BROWSER_CHANNEL` can override the browser channel. Browser tests use an isolated Vite server; native tests use the production build and temporary app data. Live native tests write synthetic transcripts to temporary storage, verify polling and cross-window updates, and intercept workspace navigation rather than opening the user's VS Code. Screenshots are written to `.artifacts/`.

## Project layout

- `src/Workspace.tsx`: full workspace, mini monitor and notification UI.
- `src/sessions.ts`: shared session types, demo state transitions and storage validation.
- `electron/main.cjs`: native windows, tray, pinning and system notifications.
- `electron/vscode-sessions.cjs`: local workspace discovery, bounded incremental reads and transcript state inference.
- `electron/preload.cjs`: a narrow, context-isolated IPC bridge.
- `tests/`: browser workflow and native window checks.

## Integration boundary

The current path is `local files -> provider adapter -> main-process snapshot -> isolated IPC -> workspace / side monitor`. The main process owns discovery and validates session IDs before opening a workspace. The renderer cannot request arbitrary filesystem reads or arbitrary external URLs.

For reliable approvals and in-app reply submission, the next step is a provider-specific bridge using supported lifecycle/input hooks where available, with authenticated local transport, stable session/request IDs, reconnect handling and explicit user confirmation. A VS Code companion extension may help with supported navigation and commands, but must not assume unrestricted access to all Copilot chats. Verify those APIs before adding reply or approval controls. Keep the transcript adapter as a clearly labeled observational fallback, not the authority for executing actions.
