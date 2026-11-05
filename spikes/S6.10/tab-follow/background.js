// Spike S6.10. Claude works in a background tab, and only an extension can switch tabs safely.
// With just the tabGroups permission this can't read any tab's address or title. It sees only a
// tab's group, and the name of that group.

// Claude in Chrome 1.0.105 names its group "Claude" or "Claude (MCP)", sometimes with a status
// mark in front or a session name instead. A group of your own with Claude in its name also matches.
const CLAUDE_GROUP = /claude/i

chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (change.status !== 'loading' || tab.active || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
    return
  }
  try {
    const group = await chrome.tabGroups.get(tab.groupId)
    if (!CLAUDE_GROUP.test(group.title ?? '')) return
    await chrome.tabs.update(tabId, { active: true })
    console.log('Switched to the tab Claude is using')
  } catch (error) {
    console.error('Could not switch to the tab Claude is using:', error)
  }
})
