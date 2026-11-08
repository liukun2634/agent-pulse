# Pulse Session Bridge

Optional, experimental bridge targeting local VS Code 1.141.x and 1.143.x / Copilot saved chats. Agent Pulse monitoring does not require this extension.

The bridge registers each window separately using its full workspace-storage location. Pulse never chooses between duplicate matching windows automatically. Requests only open saved chats that exist in the registered window, using the existing VS Code process. They do not send prompts, approve tools, change workspace folders, move the Chat sidebar, or start a new conversation.

The current result is **navigation requested**, not verified input focus. VS Code controls focus when opening the Chat resource; the stable extension API does not provide an independent confirmation of the target input focus. No reminder is consumed or reply marked read by navigation. Saved headers are validated as a stream without retaining conversation bodies; large records are supported, while malformed, partial, missing or identity-mismatched records are refused. Validation also respects the navigation request deadline.

## Local installation

From the Agent Pulse repository, run `npm --prefix vscode-session-bridge run package`. Install the generated VSIX with **Extensions: Install from VSIX** in the intended VS Code profile. Enable it only in trusted local workspaces. Pulse never installs the extension or reloads your editor automatically.

Run **Pulse Session Bridge: Show Status** in the original window. Click the arrow on a VS Code session in Pulse's workspace or mini monitor to reveal that existing session in VS Code's Chat view. Clicking the card itself opens Pulse details without navigating. The workspace minimizes after successful navigation; the mini monitor remains visible and keeps its pin setting. If multiple windows match, choose explicitly. Set **Pulse Session Bridge: Window Label** to distinguish profiles or duplicate workspaces.

An isolated VS Code 1.141.0 host verified the requested session ID in the Chat view after switching between saved conversations, with no additional editor tabs left open. The bridge resolves the saved resource and moves that Chat into the existing Chat view without relocating the view itself. The local CLI reported 1.143.1, illustrating why host version checks matter. Version 1.143.x has source/API-level checks but has not passed the same real-host test on this machine.

Remote workspaces, unsaved chats, other VS Code versions and Claude terminal navigation are not supported by this first bridge. Registration descriptors in your user-local `.agent-pulse/session-bridge` directory contain access tokens; do not share or commit them. Closed/stale registrations are ignored. Input-focus, existing drafts, multiple profiles and real conversation compatibility still require manual verification before broader support is advertised.
