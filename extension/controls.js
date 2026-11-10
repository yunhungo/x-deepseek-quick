/**
 * @created 2026-11-10
 * @description 扩展图标弹出的显示与采集设置，保存用户偏好
 * @author yunhungo
 */
import {
  normalizeTheme,
  applyAppearance,
  saveAppearance,
} from './appearance.js';

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const settings = await chrome.storage.local.get(['mode', 'theme']);
const mode = document.querySelector('#mode');
const theme = document.querySelector('#appearance');
mode.value = settings.mode === 'fixed' ? 'fixed' : 'floating';
theme.value = normalizeTheme(settings.theme);
function applyTheme() {
  applyAppearance(theme.value);
}
applyTheme();
let timer;
function report(error) {
  const notice = document.querySelector('#notice');
  notice.querySelector('span').textContent = error.message || '操作失败';
  notice.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => {
    notice.hidden = true;
  }, 5000);
}
async function act(fn) {
  try {
    await fn();
  } catch (error) {
    report(error);
  }
}
function show() {
  if (!tab?.id) return Promise.reject(new Error('请先打开网页'));
  return chrome.runtime
    .sendMessage({ type: 'show', tabId: tab.id, mode: mode.value })
    .then((result) => {
      if (!result?.ok) throw new Error(result?.error || '无法打开面板');
    });
}
mode.onchange = () =>
  act(async () => {
    await chrome.storage.local.set({ mode: mode.value });
    await show();
  });
theme.onchange = () =>
  act(async () => {
    await saveAppearance(theme.value);
    applyTheme();
  });
document.querySelector('#open').onclick = () => act(show);
async function capture(action) {
  const result = await chrome.runtime.sendMessage({
    type: 'capture-request',
    tabId: tab.id,
    action,
    mode: mode.value,
  });
  if (!result?.ok) throw new Error(result?.error || '无法采集网页');
}
document.querySelector('#select').onclick = () => act(() => capture('pick'));
document.querySelector('#whole').onclick = () => act(() => capture('page'));
function cancel() {
  return chrome.runtime.sendMessage({ type: 'cancel-pick', tabId: tab.id });
}
document.querySelector('#cancel').onclick = () => act(cancel);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') act(cancel);
});
document.querySelector('#notice button').onclick = () => {
  document.querySelector('#notice').hidden = true;
};

// Debug-only entry; normal popup layout stays unchanged.
if (new URLSearchParams(location.search).has('diagnostics')) {
  const button = document.createElement('button');
  button.textContent = '复制登录诊断';
  button.onclick = () =>
    act(async () => {
      const response = await chrome.runtime.sendMessage({
        type: 'login-probe-status',
      });
      if (!response?.ok) throw new Error('诊断尚不可用');
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            reports: response.reports,
            comparison: response.comparison,
            auth: response.auth,
          },
          null,
          2,
        ),
      );
      button.textContent = '已复制';
    });
  document.querySelector('.preferences').after(button);
}
