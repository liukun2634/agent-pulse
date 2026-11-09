# Contributing to Agent Pulse

Bug reports, usability feedback, documentation improvements and focused pull requests are welcome.

## Report an issue

[Open an issue](https://github.com/liukun2634/agent-pulse/issues) with:

- What you expected and what actually happened.
- Steps to reproduce the problem.
- Your Windows, Agent Pulse and relevant agent or editor versions.
- Whether the problem occurs in Live, Demo, the workspace or the mini monitor.

Discuss new integrations or substantial workflow changes in an issue before starting a large implementation.

## Make a change

See the [development setup](README.md#development) for prerequisites and local commands.

Keep each pull request focused on one change. Follow the existing code style, add regression coverage for behavior changes and update relevant documentation. Avoid unrelated formatting or dependency updates.

Before opening a pull request, run:

```sh
npm test
npm run build
npm run lint
```

Also run the tests relevant to the change, such as `npm run test:e2e` for workspace UI, `npm run test:desktop` for native Electron behavior, or `npm run test:vscode-bridge` for VS Code navigation.

In the pull request, describe the purpose of the change, link related issues and list the checks you ran. Note any limitations or behavior that still needs manual verification.

## License

Unless explicitly stated otherwise, contributions intentionally submitted for inclusion are provided under the [Apache License 2.0](LICENSE). Third-party components retain their respective licenses and notices.
