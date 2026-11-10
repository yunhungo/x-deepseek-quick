/**
 * @created 2026-11-10
 * @description 面板与扩展弹出页共享的外观选项、应用及持久化合同
 * @author yunhungo
 */
export const THEME_LABELS = Object.freeze({
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
});
export const THEMES = Object.freeze(Object.keys(THEME_LABELS));
export function normalizeTheme(value) {
  return THEMES.includes(value) ? value : 'system';
}
export function applyAppearance(value, root = document.documentElement) {
  root.dataset.theme = normalizeTheme(value);
}
export async function saveAppearance(value) {
  await chrome.storage.local.set({ theme: normalizeTheme(value) });
}

export function resolveScheme(value, prefersDark) {
  const theme = normalizeTheme(value);
  return theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
}
