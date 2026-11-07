# Pulse Session Bridge

Optional, experimental bridge targeting local VS Code 1.141.x and 1.143.x / Copilot saved chats. Agent Pulse monitoring does not require this extension.

The bridge registers each window separately using its full workspace-storage location. Pulse never chooses between duplicate matching windows automatically. Requests only open saved chats that exist in the registered window, using the existing VS Code process. They do not send prompts, approve tools, change workspace folders, move the Chat sidebar, or start a new conversation.

The current result is **navigation requested**, not verified input focus. VS Code controls focus when opening the Chat resource; the stable extension API does not provide an independent confirmation of the target input focus. No reminder is consumed or reply marked read by navigation. Saved data headers are checked before opening; malformed, partial, missing or oversized headers are refused.

## Local installation

From the Agent Pulse repository, run `npm --prefix vscode-session-bridge run package`. Install the generated VSIX with **Extensions: Install from VSIX** in the intended VS Code profile. Enable it only in trusted local workspaces. Pulse never installs the extension or reloads your editor automatically.

Run **Pulse Session Bridge: Show Status** in the original window. In Pulse, select a Copilot session and use **Open saved Chat in VS Code**. If multiple windows match, choose explicitly. Set **Pulse Session Bridge: Window Label** to distinguish profiles or duplicate workspaces.

An isolated VS Code 1.141.0 host passed a synthetic saved-chat test: the requested title became active, and reopening reused the existing Chat tab. The local CLI reported 1.143.1, illustrating why host version checks matter. Version 1.143.x has source/API-level checks but has not passed the same real-host test on this machine.

Remote workspaces, unsaved chats, other VS Code versions and Claude terminal navigation are not supported by this first bridge. Registration descriptors in your user-local `.agent-pulse/session-bridge` directory contain access tokens; do not share or commit them. Closed/stale registrations are ignored. Input-focus, existing drafts, multiple profiles and real conversation compatibility still require manual verification before broader support is advertised.
