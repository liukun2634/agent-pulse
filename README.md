# Agent Pulse

**English** | [简体中文](README.zh-CN.md)

A local desktop workspace for agent sessions: a pulse monitor for your AI agents, built with React, TypeScript and Electron.

The desktop app includes an **experimental, read-only VS Code / GitHub Copilot adapter**. It reads local Copilot transcript events and saved chat request state with idle-aware polling and file-change wakeups. The browser preview and the separate Demo source still use sample data. Claude Code and Codex are not connected yet.

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

## VS Code source

The desktop app starts with VS Code selected. It discovers local workspace folders and saved `.code-workspace` workspaces under VS Code's user storage. On Windows the default is `%APPDATA%\Code\User\workspaceStorage`. Open the app alongside VS Code and look for your project, then use Mini monitor to keep it at the screen edge. Settings enables optional system notifications for input requests, finished replies and session errors.

The adapter reads `GitHub.copilot-chat/transcripts/*.jsonl` incrementally. It shows up to 100 recent transcript-backed sessions, with the latest 40 timeline events per session. Session IDs include the workspace identity. Matching `chatSessions/*.jsonl` records are also read incrementally for saved titles and the latest request state. A saved `customTitle`, when available, supplies the display title; otherwise a transcript user message or a generic label is used. Saved title changes are reflected on subsequent reads. Request state can supply completion, cancellation, error and input signals that are missing from the transcript.

Lightweight directory discovery and snapshot publication run every two seconds so newly created or removed sessions remain visible. For known sessions, file checks and reads back off with idle time: 2 seconds below 30 seconds idle, 5 seconds below 2 minutes, 15 seconds below 10 minutes, then 60 seconds. Changes in transcript or saved-chat directories wake the affected session on the next discovery tick. New transcript activity or a newer saved request restores fast checks. If filesystem notifications are unavailable or missed, the bounded polling interval remains the fallback. Manual Refresh and switching to VS Code bypass the idle delay. Partial writes and unread backlog stay on fast polling.

Cards, the side monitor and session details display **Idle**, the time since the last observed transcript activity, updated every second without rereading the log. It continues to grow after a reply finishes and resets when a newer event arrives. This is not a claim that the agent is doing no work. **Elapsed** remains separately available in the details and freezes when the observed reply ends.

For VS Code Insiders, a portable installation or another user-data directory, set the storage root before launching. For example, in PowerShell:

```powershell
$env:PULSE_VSCODE_STORAGE = Join-Path $env:APPDATA 'Code - Insiders\User\workspaceStorage'
$env:PULSE_VSCODE_SCHEME = 'vscode-insiders'
npm run desktop
```

Only `vscode` and `vscode-insiders` URL schemes are supported. Missing or unreadable storage is shown explicitly; Pulse never substitutes demo sessions for a failed connection. VS Code versions that do not write this transcript format, untitled workspaces, remote-only workspace URIs and other providers are not supported by this adapter.

### Status semantics

| Status | Evidence |
| --- | --- |
| In progress | A user message, assistant turn or tool event is active, or a newer saved request has started. |
| Needs input | A known question tool, such as `vscode_askQuestions`, is pending, or the current saved request indicates input is needed. |
| Completed | A nonempty assistant reply without tool requests is followed by a turn end with no pending tools, or the current saved request records a successful finish. This means the reply ended, not that the task succeeded. |
| Failed | An explicit `session.error` event, or a finished saved request marked with an error. A failed tool alone does not fail the session because the agent may recover. |
| Stopped | The current saved request records cancellation. |
| No recent activity | A previously running session has no new activity for two minutes and no completion signal. The agent may still be working. |
| Status unknown | Incomplete lifecycle evidence or a partial log update. Silence never implies completion. |

These are inferred states from internal, version-dependent files, not an official Copilot lifecycle API or a VS Code process heartbeat. Some permission prompts, cancellations and final responses may not be recorded in either source. Missing completion signals may leave a session idle or unknown; an observed input request can remain waiting until a later update resolves it. Historical transcripts remain visible and are not necessarily open chats. Branch and file-change counts are not inferred, and elapsed time starts at the earliest observed transcript event.

**Open VS Code workspace opens the owning folder/workspace, not an exact chat.** Select the relevant conversation in VS Code to reply or approve permissions. Pulse does not submit messages, inject keystrokes, edit VS Code chat storage or auto-approve requests.

Live snapshots stay in process memory and are not written to the demo cache. No tool arguments, tool outputs or reasoning text are sent to the renderer. Titles, optional user-message task labels, workspace names and event summaries are local session information; enabling system notifications may expose project/task names on the OS notification surface. The adapter does not upload this data.

## Available interactions

- Switch between VS Code and Demo in the desktop workspace. Both native windows use the same source.
- Search and filter sessions by status and provider; switch grid and list layouts.
- Inspect the session timeline, task details, elapsed time and live idle duration.
- In Demo only, run a completion demo, approve a sample request, or retry a sample failure. These controls cannot mutate real sessions.
- Receive in-app completion alerts; optionally enable system notifications and sound in Settings.
- Minimize the native workspace, or click Mini monitor, to switch to a side monitor on the current display. The main window hides instead of competing for desktop space.
- Collapse the side monitor into a narrow task rail; switch between the left and right screen edges.
- Click a task in either side-monitor layout to restore its detail panel. The side monitor hides when the workspace opens.
- Use Expand workspace to maximize the full panel; minimizing it returns to the side monitor.
- Both windows synchronize session state and preferences locally. Live source updates come from one Electron collector; demo changes use local storage. Alerts also appear in the side monitor while the main panel is hidden.
- Pin either native window above other windows. Browser windows cannot provide system-wide pinning.
- Drag the native mini monitor by its header. Its footer stays visible while sessions scroll.
- Close the native workspace to keep it in the tray. Use "Quit Pulse" in the tray menu to exit.

System notifications depend on OS notification settings. The browser preview asks for permission only when notifications are enabled. Browser popups must be allowed to open the mini monitor.

The browser preview can display both compact layouts, but cannot read local VS Code sessions or dock, maximize or pin OS windows. Switching modes in the native app controls real windows. Task shortcuts open Pulse's session details; the detail panel has the separate VS Code workspace action.

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
