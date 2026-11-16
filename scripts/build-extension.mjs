/**
 * @created 2026-11-10
 * @description 构建扩展并复用桌面应用图标及网页适配器
 * @author yunhungo
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { compile } from 'sass';
const output = new URL('../extension/dist/', import.meta.url);
await mkdir(new URL('icons/', output), { recursive: true });
// Remove the retired debugger module from this fixed build output.
await rm(new URL('accessibility.js', output), { force: true });
for (const file of [
  'manifest.json',
  'bootstrap.js',
  'worker.js',
  'page-selection.js',
  'plugin-notice.js',
  'panel.html',
  'panel.js',
  'upload.js',
  'controls.html',
  'controls.js',
  'icons.svg',
  'appearance.js',
  'panel-opening.js',
  'login-scope.js',
  'auth-client.js',
  'auth-session.js',
  'auth-contract.js',
]) {
  await cp(
    new URL(`../extension/${file}`, import.meta.url),
    new URL(file, output),
  );
}
const sourceScript = await readFile(
  new URL('../extension/source.js', import.meta.url),
  'utf8',
);
const sourceStyles = compile(
  new URL('../extension/source.scss', import.meta.url).pathname,
).css;
await writeFile(
  new URL('source.js', output),
  sourceScript.replace(
    "'__DSQUICK_SOURCE_STYLE__'",
    JSON.stringify(sourceStyles),
  ),
);
await writeFile(
  new URL('panel.css', output),
  compile(new URL('../extension/panel.scss', import.meta.url).pathname).css,
);
await cp(
  new URL('../src-tauri/scripts/glass.js', import.meta.url),
  new URL('glass.js', output),
);
for (const size of [32, 128]) {
  await cp(
    new URL(`../src-tauri/icons/${size}x${size}.png`, import.meta.url),
    new URL(`icons/${size}.png`, output),
  );
}
console.log('Chrome extension: extension/dist');
