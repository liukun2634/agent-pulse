# Agent Pulse

Keep your agent sessions in view. Know when input is needed or a reply is ready, and inspect recent activity in one local monitor.

[Website](https://liukun2634.github.io/agent-pulse/) | [Download for Windows](https://liukun2634.github.io/agent-pulse/download.html) | [Releases](https://github.com/liukun2634/agent-pulse/releases) | [Report an issue](https://github.com/liukun2634/agent-pulse/issues)

[![CI](https://github.com/liukun2634/agent-pulse/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/liukun2634/agent-pulse/actions/workflows/ci.yml)

Agent Pulse brings your coding sessions into one local workspace. Browse and organize your work in the full window, or keep the compact side monitor nearby while your agents run.

> Development preview for Windows x64. Monitor local VS Code / GitHub Copilot and independent Claude Code terminal sessions.

![Agent Pulse workspace with session cards, filters and activity details](site/assets/workspace.png)

<details>
<summary>Mini monitor preview</summary>

<img src="site/assets/mini.png" width="300" alt="Agent Pulse mini monitor showing projects, session status and recent activity" />

</details>

Screenshots use Demo data. Claude Code snapshot monitoring is available; Codex is not connected yet.

## Features

- **See what needs attention.** Follow running sessions, input requests and ready replies at a glance, with active sessions checked every two seconds.
- **Keep progress in view.** Pin the mini monitor, dock it on either screen edge or collapse it into a narrow rail.
- **Stay focused.** Brief notifications let you know when to act without taking keyboard focus. Revisit pending reminders from the bell inbox.
- **Inspect recent activity.** Open a session's details and timeline directly in Pulse from the mini monitor or a reminder.
- **Organize your sessions.** Search, filter, inspect activity, and archive or restore sessions without interrupting the agent.
- **Keep your data local.** No account, telemetry or model API key required. Your conversations stay on your device.

## Download and get started

Visit the **[Windows download page](https://liukun2634.github.io/agent-pulse/download.html)** for available builds and installation instructions. Release files are hosted on [GitHub Releases](https://github.com/liukun2634/agent-pulse/releases). If no installer is available yet, [try it from source](#development).

1. Install Agent Pulse on Windows. Packaged releases do not require Node.js.
2. Use your existing VS Code / GitHub Copilot setup or a separately installed Claude Code CLI. Pulse monitoring requires no additional editor extension.
3. Launch Pulse and select **Live** to see VS Code and Claude Code sessions together. Use the Agent filter to narrow the list, or **Mini monitor** to follow progress. **Demo** stays separate; switching views does not stop live monitoring.

> Preview builds are unsigned and may trigger Windows security warnings. Verify the download source and checksums; do not disable system security protections.

## Project status

Agent Pulse is actively evolving, with monitoring as the current focus. Session actions open Pulse details, not external editor or terminal windows. Claude Code supports session snapshots and observed input/error states; exact per-turn events are still in development. Idle is not treated as a finished reply, and Claude runtime starts when Pulse observes execution. The browser preview uses sample data only.

Keep Pulse running, including in the tray, to receive reminders. Provider formats may vary between versions. Pulse observes sessions without sending messages, approving permissions or installing hooks on your behalf.

## Development

Built with Electron, React and TypeScript. Use **Node.js 24 LTS or newer** on Windows:

```sh
git clone https://github.com/liukun2634/agent-pulse.git
cd agent-pulse
npm ci
npm run desktop:dev
```

Use `npm run dev` for a browser-only Demo, or `npm run build:site` to build the project website.

Before opening a pull request, run `npm test`, `npm run build` and `npm run lint`, plus the tests relevant to your change.

## Contributing

Bug reports, usability feedback, documentation improvements and focused pull requests are welcome. Try Pulse in your workflow and help shape what comes next.

- **Share feedback:** [open an issue](https://github.com/liukun2634/agent-pulse/issues) with what you expected and what happened. Include your app and VS Code versions for bugs.
- **Improve the project:** pick a focused change, describe its purpose and include a check for the behavior you change.
- **Propose bigger ideas:** discuss new integrations or workflow changes in an issue before starting a large implementation.

Remove private conversation content, credentials and sensitive paths from any logs or screenshots you share.
