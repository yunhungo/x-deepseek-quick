/**
 * @created 2026-11-10
 * @description 面板工具栏、主题与经用户触发的附件传递
 * @author yunhungo
 */
import {
  THEME_LABELS,
  normalizeTheme,
  applyAppearance,
  saveAppearance,
  resolveScheme,
} from './appearance.js';

const floating = new URLSearchParams(location.search).has('floating');
document.querySelector('#toolbar').hidden = !floating;
document.documentElement.dataset.mode = floating ? 'floating' : 'fixed';
let selecting = false;
const chat = document.querySelector('#chat');
function configureGlass() {
  chat.contentWindow.postMessage(
    { type: 'dsquick-configure' },
    'https://chat.deepseek.com',
  );
}
chat.addEventListener('load', configureGlass);
let ready = false,
  timer,
  requesting = false,
  busy = false;
const sourceTab = Number(new URLSearchParams(location.search).get('source'));
const pending = [];
function notify(text) {
  const notice = document.querySelector('#notice');
  notice.querySelector('span').textContent = text;
  notice.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => {
    notice.hidden = true;
  }, 5000);
}
async function request(type, extra = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...extra });
  if (!result?.ok) throw new Error(result?.error || '操作失败');
  return result;
}
async function act(fn) {
  try {
    await fn();
  } catch (error) {
    notify(error.message);
  }
}
document.querySelector('#notice button').onclick = () => {
  document.querySelector('#notice').hidden = true;
};
const routeKey = `route:${sourceTab}`;
await act(async () => {
  await request('prepare');
  const saved = await chrome.storage.session.get(routeKey);
  const url =
    typeof saved[routeKey] === 'string' ? new URL(saved[routeKey]) : null;
  chat.src =
    url?.origin === 'https://chat.deepseek.com'
      ? url.href
      : 'https://chat.deepseek.com/';
});
const settings = await chrome.storage.local.get('theme');
const labels = THEME_LABELS;
let theme = normalizeTheme(settings.theme);
const themeButton = document.querySelector('#theme');
const themeMenu = document.querySelector('#theme-menu');
const themeOptions = [...themeMenu.querySelectorAll('button')];
function applyTheme() {
  applyAppearance(theme);
  if (floating)
    request('frame-scheme', {
      scheme: resolveScheme(
        theme,
        matchMedia('(prefers-color-scheme: dark)').matches,
      ),
    }).catch(() => {});
  themeButton.title = `外观：${labels[theme]}`;
  themeButton.setAttribute('aria-label', themeButton.title);
  for (const option of themeOptions) {
    option.setAttribute(
      'aria-checked',
      String(option.dataset.themeChoice === theme),
    );
  }
}
function closeTheme(restoreFocus = false) {
  themeMenu.hidden = true;
  themeButton.setAttribute('aria-expanded', 'false');
  if (restoreFocus) themeButton.focus();
}
function openTheme() {
  themeMenu.hidden = false;
  themeButton.setAttribute('aria-expanded', 'true');
  themeOptions.find((option) => option.dataset.themeChoice === theme).focus();
}
applyTheme();
themeButton.onclick = () => (themeMenu.hidden ? openTheme() : closeTheme(true));
themeButton.addEventListener('keydown', (event) => {
  if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault();
    openTheme();
  }
});
for (const option of themeOptions) {
  option.onclick = () =>
    act(async () => {
      const previous = theme;
      theme = option.dataset.themeChoice;
      applyTheme();
      closeTheme(true);
      try {
        await saveAppearance(theme);
      } catch (error) {
        theme = previous;
        applyTheme();
        throw error;
      }
    });
}
themeMenu.addEventListener('keydown', (event) => {
  const index = themeOptions.indexOf(document.activeElement);
  if (event.key === 'Escape') {
    event.preventDefault();
    closeTheme(true);
  }
  if (event.key === 'Tab') closeTheme();
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? 2
          : (index + (event.key === 'ArrowDown' ? 1 : 2)) % 3;
    themeOptions[next].focus();
  }
});
document.addEventListener('pointerdown', (event) => {
  if (!themeMenu.contains(event.target) && !themeButton.contains(event.target))
    closeTheme();
});
window.addEventListener('blur', () => closeTheme());
document.querySelector('#login').onclick = () =>
  chrome.tabs.create({ url: 'https://chat.deepseek.com/' });
document.querySelector('#pick').onclick = () => capture('pick');
document.querySelector('#page').onclick = () => capture('page');
async function capture(type) {
  await act(async () => {
    if (busy) throw new Error('请等待当前附件处理完成');
    if (pending.length) {
      await deliver();
      return;
    }
    await request('source');
    requesting = true;
    selecting = type === 'pick';
    await request(type);
  });
}
document.querySelector('#pin').hidden = true;
document.querySelector('#close').hidden = !floating;
document.querySelector('#close').onclick = () =>
  act(() => request('hide-floating'));
function cancelSelection() {
  if (!selecting) return;
  selecting = false;
  requesting = false;
  act(() => request('cancel-pick'));
}
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !themeMenu.hidden) return;
  cancelSelection();
});
window.addEventListener('message', (event) => {
  if (
    event.origin === 'https://chat.deepseek.com' &&
    event.source === chat.contentWindow &&
    event.data?.type === 'dsquick-escape'
  )
    cancelSelection();
});
let pointer;
const toolbar = document.querySelector('#toolbar');
toolbar.addEventListener('pointerdown', (event) => {
  if (!floating || event.target.closest('button')) return;
  pointer = { x: event.screenX, y: event.screenY };
  toolbar.setPointerCapture(event.pointerId);
});
toolbar.addEventListener('pointermove', (event) => {
  if (!pointer) return;
  request('move-floating', {
    dx: event.screenX - pointer.x,
    dy: event.screenY - pointer.y,
  }).catch(() => {});
  pointer = { x: event.screenX, y: event.screenY };
});
for (const type of ['pointerup', 'lostpointercapture'])
  toolbar.addEventListener(type, () => {
    pointer = undefined;
  });
async function deliver() {
  if (!ready || busy || !pending.length) return;
  busy = true;
  const item = pending[0];
  chat.contentWindow.postMessage(
    { type: 'dsquick-upload', id: item.id, files: item.files },
    'https://chat.deepseek.com',
  );
  item.timeout = setTimeout(() => {
    busy = false;
    notify('官网尚未接受附件，请打开附件控件后再点整页或选择');
  }, 8000);
}
window.addEventListener('message', (event) => {
  if (
    event.origin !== 'https://chat.deepseek.com' ||
    event.source !== chat.contentWindow
  )
    return;
  if (['dsquick-ready', 'dsquick-location'].includes(event.data?.type)) {
    const href = event.data.href;
    if (
      typeof href === 'string' &&
      href.startsWith('https://chat.deepseek.com/')
    ) {
      chrome.storage.session.set({ [routeKey]: href }).catch(() => {});
    }
  }
  if (
    event.data?.type === 'dsquick-glass-ready' &&
    ['light', 'dark'].includes(event.data.scheme)
  )
    chat.style.colorScheme = event.data.scheme;
  if (event.data?.type === 'dsquick-ready') {
    configureGlass();
    ready = true;
    deliver();
  }
  if (
    event.data?.type === 'dsquick-result' &&
    event.data.id === pending[0]?.id
  ) {
    clearTimeout(pending[0].timeout);
    busy = false;
    if (event.data.ok) {
      pending.shift();
      deliver();
    } else {
      notify((event.data.error || '附件添加失败') + '；点击采集按钮重试');
    }
  }
});
chrome.runtime.onMessage.addListener((message, sender) => {
  if (
    sender.id === chrome.runtime.id &&
    sender.url === chrome.runtime.getURL('worker.js') &&
    message.type === 'command-error' &&
    message.tabId === sourceTab
  ) {
    notify('无法执行快捷键，请在网页中重试');
    return;
  }
  if (
    sender.id === chrome.runtime.id &&
    sender.url === chrome.runtime.getURL('controls.html') &&
    message.tabId === sourceTab
  ) {
    if (message.type === 'panel-capture') capture(message.action);
    if (message.type === 'panel-cancel') cancelSelection();
    return;
  }
  if (
    !requesting ||
    sender.id !== chrome.runtime.id ||
    sender.tab?.id !== sourceTab ||
    sender.frameId !== 0 ||
    message.type !== 'capture'
  )
    return;
  requesting = false;
  selecting = false;
  act(async () => {
    if (
      !message.payload ||
      typeof message.payload.text !== 'string' ||
      message.payload.text.length > 220000
    )
      throw new Error('网页内容无效或过大');
    const id = crypto.randomUUID();
    if (!message.imageRect) await request('restore');
    const files = [
      { name: `${id}.txt`, type: 'text/plain', text: message.payload.text },
    ];
    if (message.imageRect) {
      const r = message.imageRect;
      let image;
      try {
        ({ image } = await request('screenshot'));
      } finally {
        await request('restore');
      }
      const bitmap = await createImageBitmap(await (await fetch(image)).blob());
      const scale = bitmap.width / r.viewportWidth;
      const x = Math.max(0, r.x),
        y = Math.max(0, r.y);
      const width = Math.min(r.width + Math.min(r.x, 0), r.viewportWidth - x);
      const height = Math.min(
        r.height + Math.min(r.y, 0),
        r.viewportHeight - y,
      );
      if (width <= 0 || height <= 0) throw new Error('图片不在可见区域');
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      canvas
        .getContext('2d')
        .drawImage(
          bitmap,
          x * scale,
          y * scale,
          width * scale,
          height * scale,
          0,
          0,
          canvas.width,
          canvas.height,
        );
      bitmap.close();
      files.splice(0, 1, {
        name: `${id}.png`,
        type: 'image/png',
        data: canvas.toDataURL(),
      });
    }
    pending.push({ id, files });
    await deliver();
  });
});
window.addEventListener('pagehide', () => {
  clearTimeout(timer);
  for (const item of pending) clearTimeout(item.timeout);
});

const captureKey = `capture:${sourceTab}`;
async function consumeCapture(task) {
  if (
    !task ||
    task.mode !== (floating ? 'floating' : 'fixed') ||
    !['pick', 'page'].includes(task.action)
  )
    return;
  await chrome.storage.session.remove(captureKey);
  await capture(task.action);
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes[captureKey]?.newValue)
    consumeCapture(changes[captureKey].newValue);
  if (area === 'local' && changes.theme) {
    theme = normalizeTheme(changes.theme.newValue);
    applyTheme();
  }
});
consumeCapture((await chrome.storage.session.get(captureKey))[captureKey]);

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (theme === 'system') applyTheme();
});
