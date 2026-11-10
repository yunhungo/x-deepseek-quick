/**
 * @created 2026-11-10
 * @description 通过官网原生附件控件接收文件，不调用私有上传接口
 * @author yunhungo
 */
(() => {
  if (window === window.top) return;
  const parentOrigin = chrome.runtime.getURL('').slice(0, -1);
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape')
        parent.postMessage({ type: 'dsquick-escape' }, parentOrigin);
    },
    true,
  );
  const completed = new Set();
  window.addEventListener('message', async (event) => {
    if (
      event.source !== parent ||
      event.origin !== parentOrigin ||
      event.data?.type !== 'dsquick-upload'
    )
      return;
    const { id, files } = event.data;
    if (typeof id !== 'string' || !Array.isArray(files) || files.length > 5)
      return;
    const answer = (ok, error) =>
      parent.postMessage(
        { type: 'dsquick-result', id, ok, error },
        parentOrigin,
      );
    if (completed.has(id)) {
      answer(true);
      return;
    }
    try {
      const candidates = [
        ...document.querySelectorAll('input[type="file"]'),
      ].filter((input) => !input.disabled);
      if (!candidates.length)
        throw new Error('未找到官网附件控件，请先登录并打开聊天');
      const transfer = new DataTransfer();
      for (const file of files) {
        if (
          typeof file.name !== 'string' ||
          !/^[\w-]+\.(txt|png)$/.test(file.name)
        )
          throw new Error('附件格式无效');
        if (
          file.type === 'text/plain' &&
          typeof file.text === 'string' &&
          file.text.length <= 220000
        ) {
          transfer.items.add(
            new File([file.text], file.name, { type: file.type }),
          );
        } else if (
          file.type === 'image/png' &&
          typeof file.data === 'string' &&
          file.data.startsWith('data:image/png;base64,') &&
          file.data.length < 20000000
        ) {
          transfer.items.add(
            new File([await (await fetch(file.data)).blob()], file.name, {
              type: file.type,
            }),
          );
        } else throw new Error('不支持的附件');
      }
      const accepts = (input) =>
        !input.accept ||
        [...transfer.files].every((file) =>
          input.accept.split(',').some((raw) => {
            const a = raw.trim();
            return (
              a === file.type ||
              a === '.' + file.name.split('.').pop() ||
              (a.endsWith('/*') && file.type.startsWith(a.slice(0, -1)))
            );
          }),
        );
      const input = candidates.find(accepts);
      if (!input) throw new Error('官网当前附件控件不支持此文件');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      completed.add(id);
      if (completed.size > 100)
        completed.delete(completed.values().next().value);
      answer(true);
    } catch (error) {
      answer(false, error.message);
    }
  });
  function announce() {
    parent.postMessage(
      { type: 'dsquick-ready', href: location.href },
      parentOrigin,
    );
  }
  let previousUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href === previousUrl) return;
    previousUrl = location.href;
    parent.postMessage(
      { type: 'dsquick-location', href: previousUrl },
      parentOrigin,
    );
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  window.addEventListener('pagehide', () => observer.disconnect(), {
    once: true,
  });
  announce();
  window.addEventListener('pageshow', announce);
})();
