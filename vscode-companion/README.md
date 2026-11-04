# Pulse Companion

Local companion for the Pulse desktop monitor. Version 0.4 focuses its already-open VS Code window before opening a selected Copilot conversation in Chat view, normally located in the secondary side bar. It preserves the user's view placement and never submits messages or approves tools. Pulse does not launch a folder URL or create a new VS Code window as a navigation fallback.

The extension activates when a local folder or saved workspace opens. Run **Pulse: Show Connection Status** to activate it immediately and see the connected workspace. No network listener is created. The local pipe is authenticated with a random token stored in the current user's home directory.

Registration is refreshed atomically when this window gains focus or when the connection-status command runs. A client retries once if a failed pipe was replaced by a newer registration. Missing registration, stale connection, timeout, missing session storage and navigation failures remain distinct; a registered but unreadable session is not reported as an inactive extension. Sidebar movement waits for the asynchronous Chat tab-close notification before confirming success.

From the Pulse repository root, package and install the development extension:

```sh
npm --prefix vscode-companion run package
code --install-extension .artifacts/pulse-companion.vsix --force
```

Reload the VS Code window after updating an already-active companion, or run the connection-status command after a fresh installation. Then select **Open in VS Code** in Pulse. A running old extension is not automatically replaced by installing the VSIX; Pulse reports when a reload is needed.

Navigation requests are serialized. When available, `workbench.action.focusWindow` brings this existing window forward. The companion associates a newly opened Chat tab with the requested resource before using `workbench.action.chat.openInSidebar`; it does not blindly move whichever chat happens to be active. A confirmed move returns `chat-view`. Missing commands or unidentified tabs return an explicit `chat-editor` fallback. For an existing editor tab that this companion cannot identify, close that chat editor and retry. Without a connected companion, Pulse reports `unavailable` and leaves the reminder pending.

The installed VS Code build was checked in an isolated extension host with two saved sessions and a repeated open. Each moved to Chat view without accumulating editor tabs. Other VS Code versions, existing drafts, relocated Chat views and multiple workspace windows still need separate compatibility checks.

Opening local chat resources depends on the current VS Code internal `vscode-chat-session` URI format. This is an experimental development integration, not a stable public Copilot API. Remote-only workspaces are not supported.
