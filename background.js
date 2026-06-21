chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "START_BALANCE_CHECK") {
    startBalanceCheck(message.payload).then(sendResponse);
    return true;
  }

  if (message?.type === "GET_PENDING_BALANCE_CHECK") {
    getPendingBalanceCheck(sender.tab?.id).then(sendResponse);
    return true;
  }

  return false;
});

async function startBalanceCheck(payload) {
  const tab = await chrome.tabs.create({ url: payload.url, active: true });
  const key = tabKey(tab.id);
  await chrome.storage.session.set({ [key]: payload.card });
  return { ok: true };
}

async function getPendingBalanceCheck(tabId) {
  if (!tabId) return { payload: null };
  const key = tabKey(tabId);
  const result = await chrome.storage.session.get(key);
  await chrome.storage.session.remove(key);
  return { payload: result[key] ?? null };
}

function tabKey(tabId) {
  return `pendingBalanceCheck:${tabId}`;
}
