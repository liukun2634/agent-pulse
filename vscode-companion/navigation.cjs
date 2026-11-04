function createChatNavigator(vscode) {
  const resources = new WeakMap()
  let queue = Promise.resolve()

  async function navigate(resource) {
    const commands = await vscode.commands.getCommands(true)
    if (commands.includes('workbench.action.focusWindow'))
      await vscode.commands.executeCommand('workbench.action.focusWindow')
    const resourceKey = resource.toString()
    const opened = new Set()
    const subscription = vscode.window.tabGroups.onDidChangeTabs((event) => {
      for (const tab of event.opened) opened.add(tab)
    })
    try {
      await vscode.commands.executeCommand('vscode.open', resource, {
        preview: false,
        preserveFocus: false,
      })
    } finally {
      subscription.dispose()
    }
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab
    const isChat =
      typeof vscode.TabInputChat === 'function' && tab?.input instanceof vscode.TabInputChat
    const identified =
      isChat && (resources.get(tab) === resourceKey || (opened.size === 1 && opened.has(tab)))
    if (!identified)
      return {
        mode: 'chat-editor',
        verified: false,
        message:
          'Chat opened in an editor, but its tab could not be verified. If it was already open, close that chat editor and retry to move it to Chat view.',
      }
    resources.set(tab, resourceKey)
    if (!commands.includes('workbench.action.chat.openInSidebar'))
      return {
        mode: 'chat-editor',
        verified: true,
        message:
          'This VS Code version does not provide Move Chat into Side Bar. The session is open in an editor.',
      }
    try {
      let confirmMoved
      let timer
      const moved = new Promise((resolve) => {
        confirmMoved = resolve
      })
      const changes = vscode.window.tabGroups.onDidChangeTabs((event) => {
        if (event.closed?.includes(tab)) confirmMoved(true)
      })
      let confirmed
      try {
        await vscode.commands.executeCommand('workbench.action.chat.openInSidebar')
        const stillInEditor = vscode.window.tabGroups.all.some((group) => group.tabs.includes(tab))
        if (!stillInEditor) confirmMoved(true)
        timer = setTimeout(() => confirmMoved(false), 1200)
        confirmed = await moved
      } finally {
        clearTimeout(timer)
        changes.dispose()
      }
      if (confirmed) return { mode: 'chat-view', verified: true }
      return {
        mode: 'chat-editor',
        verified: true,
        message:
          'The session opened, but VS Code did not confirm moving it out of the editor. Your layout was left unchanged.',
      }
    } catch {
      return {
        mode: 'chat-editor',
        verified: true,
        message: 'Chat view could not be opened. The session remains available in the editor.',
      }
    }
  }

  return {
    open(resource) {
      const next = queue.then(() => navigate(resource))
      queue = next.catch(() => {})
      return next
    },
  }
}

module.exports = { createChatNavigator }
