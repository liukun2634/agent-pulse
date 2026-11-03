# Pulse

A local desktop workspace for agent sessions, built with React, TypeScript and Electron.

**This is an interactive interface preview, not a live agent integration.** All sessions are labeled demo data. No Copilot, Claude Code or Codex conversations are read. "Open session" reports that no external agent window is connected.

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

## Available interactions

- Search and filter sample sessions by status and provider; switch grid and list layouts.
- Inspect the session timeline, task details and elapsed time.
- Run a completion demo, approve a sample request, or retry a sample failure.
- Receive in-app completion alerts; optionally enable system notifications and sound in Settings.
- Minimize the native workspace, or click Mini monitor, to switch to a side monitor on the current display. The main window hides instead of competing for desktop space.
- Collapse the side monitor into a narrow task rail; switch between the left and right screen edges.
- Click a sample task in either side-monitor layout to restore its detail panel. The side monitor hides when the workspace opens.
- Use Expand workspace to maximize the full panel; minimizing it returns to the side monitor.
- Both windows synchronize sample session state and preferences locally. Completion alerts also appear in the side monitor while the main panel is hidden.
- Pin either native window above other windows. Browser windows cannot provide system-wide pinning.
- Drag the native mini monitor by its header. Its footer stays visible while sessions scroll.
- Close the native workspace to keep it in the tray. Use "Quit Pulse" in the tray menu to exit.

System notifications depend on OS notification settings. The browser preview asks for permission only when notifications are enabled. Browser popups must be allowed to open the mini monitor.

The browser preview can display both compact layouts, but cannot dock, maximize or pin OS windows. Switching modes in the native app controls real windows. Task shortcuts currently open Pulse's sample session details, not an external agent chat.

Sample data and preferences are stored on the device. Reset demo restores the six sample sessions. No account, telemetry, external fonts or model API key is required.

## Checks

```sh
npm test
npm run test:e2e
npm run test:desktop
npm run build
npm run lint
```

Browser tests use Microsoft Edge on Windows and Playwright Chromium on other platforms. Install the matching browser before running the tests. `PULSE_BROWSER_CHANNEL` can override the browser channel. Browser tests use an isolated Vite server; native tests use the production build and temporary app data. Screenshots are written to `.artifacts/`.

## Project layout

- `src/Workspace.tsx`: full workspace, mini monitor and notification UI.
- `src/sessions.ts`: typed sample sessions, state transitions and storage validation.
- `electron/main.cjs`: native windows, tray, pinning and system notifications.
- `electron/preload.cjs`: a narrow, context-isolated IPC bridge.
- `tests/`: browser workflow and native window checks.

## Integration boundary

The next step is a provider-specific adapter using documented lifecycle events or hooks. A silent or disconnected agent must not be reported as completed. Session identity, approval requests and external-window navigation need to be verified for each provider before enabling live monitoring.
