/**
 * @created 2026-11-10
 * @description 在用户点击期间同步打开当前标签页的固定侧栏
 * @author yunhungo
 */
export function configureFixedPanel(api, tabId) {
  return api.sidePanel.setOptions({
    tabId,
    path: `panel.html?source=${tabId}`,
    enabled: true,
  });
}

export function openFixedPanel(api, tabId) {
  // Invoke open before any await, storage write, or cross-context message.
  const configured = configureFixedPanel(api, tabId);
  const opened = api.sidePanel.open({ tabId });
  return Promise.all([configured, opened]);
}
