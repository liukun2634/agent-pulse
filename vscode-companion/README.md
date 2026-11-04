# Pulse Companion

Local companion for the Pulse desktop monitor. It opens a selected Copilot conversation in its owning VS Code workspace and focuses the chat input. It never submits messages or approves tools.

The extension activates when a local folder or saved workspace opens. Run **Pulse: Show Connection Status** to activate it immediately and see the connected workspace. No network listener is created. The local pipe is authenticated with a random token stored in the current user's home directory.

From the Pulse repository root, package and install the development extension:

```sh
npm --prefix vscode-companion run package
code --install-extension .artifacts/pulse-companion.vsix --force
```

Reload the VS Code window after installation, or run the connection-status command if it is already available. Then select **Open in VS Code** in Pulse. Without a connected companion, Pulse falls back to opening the workspace.

Opening local chat resources depends on the current VS Code internal `vscode-chat-session` URI format. This is an experimental development integration, not a stable public Copilot API. Remote-only workspaces are not supported.
