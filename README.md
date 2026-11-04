# Agent Pulse

Keep your agent sessions in view. Know when input is needed or a reply is ready, then return to the right conversation.

[Website](https://liukun2634.github.io/agent-pulse/) | [Download for Windows](https://liukun2634.github.io/agent-pulse/download.html) | [Releases](https://github.com/liukun2634/agent-pulse/releases) | [Report an issue](https://github.com/liukun2634/agent-pulse/issues)

[![CI](https://github.com/liukun2634/agent-pulse/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/liukun2634/agent-pulse/actions/workflows/ci.yml)

Agent Pulse brings your coding sessions into one local workspace. Browse and organize your work in the full window, or keep the compact side monitor nearby while your agents run.

> Development preview for Windows x64. Currently supports local VS Code / GitHub Copilot.

![Agent Pulse workspace with session cards, filters and activity details](site/assets/workspace.png)

<details>
<summary>Mini monitor preview</summary>

<img src="site/assets/mini.png" width="300" alt="Agent Pulse mini monitor showing projects, session status and recent activity" />

</details>

Screenshots use Demo data. Claude Code and Codex integrations are planned, not connected yet.

## Features

- **See what needs attention.** Follow running sessions, input requests and ready replies at a glance, with active sessions checked every two seconds.
- **Keep progress in view.** Pin the mini monitor, dock it on either screen edge or collapse it into a narrow rail.
- **Stay focused.** Brief notifications let you know when to act without taking keyboard focus. Revisit pending reminders from the bell inbox.
- **Pick up the conversation.** Jump to the matching chat in your existing VS Code window with Pulse Companion.
- **Organize your sessions.** Search, filter, inspect activity, and archive or restore sessions without interrupting the agent.
- **Keep your data local.** No account, telemetry or model API key required. Your conversations stay on your device.

## Download and get started

Visit the **[Windows download page](https://liukun2634.github.io/agent-pulse/download.html)** for available builds and installation instructions. Release files are hosted on [GitHub Releases](https://github.com/liukun2634/agent-pulse/releases). If no installer is available yet, [try it from source](#development).

1. Install Agent Pulse on Windows. Packaged releases do not require Node.js.
2. Install Pulse Companion in VS Code using **Extensions: Install from VSIX** to enable conversation navigation.
3. Open your project in VS Code, launch Pulse and select the **VS Code** source. Use **Mini monitor** to follow progress and jump back when a session needs you.

Companion setup details: [vscode-companion/README.md](vscode-companion/README.md).

> Preview builds are unsigned and may trigger Windows security warnings. Verify the download source and checksums; do not disable system security protections.

## Project status

Agent Pulse is actively evolving. Live monitoring currently supports local VS Code / GitHub Copilot on Windows x64; more providers and languages are planned. The browser preview uses sample data only.

Session status is inferred from local VS Code records and may vary between versions. Keep Pulse running, including in the tray, to receive reminders. It observes sessions without sending messages or approving permissions on your behalf.

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
