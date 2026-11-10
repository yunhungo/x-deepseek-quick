/**
 * @created 2026-11-10
 * @description 官网登录存储共享合同，区分空登录包装、有效凭据和未知格式
 * @author yunhungo
 */
(function (root) {
  const AUTH_KEY = 'userToken';
  function classifyAuthValue(value) {
    if (value === null || value === undefined || value === '') return 'empty';
    if (typeof value !== 'string' || value.length > 16384) return 'unsupported';
    const text = value.trim();
    if (!text || ['null', 'undefined'].includes(text)) return 'empty';
    try {
      const parsed = JSON.parse(text);
      if (parsed === null) return 'empty';
      if (typeof parsed === 'string') return parsed.trim() ? 'valid' : 'empty';
      if (
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        !Object.hasOwn(parsed, 'value')
      )
        return 'unsupported';
      if (parsed.value === null || parsed.value === '') return 'empty';
      return typeof parsed.value === 'string' && parsed.value.trim()
        ? 'valid'
        : 'unsupported';
    } catch {
      return /^[A-Za-z0-9._~+\/-]{8,}={0,2}$/.test(text)
        ? 'valid'
        : 'unsupported';
    }
  }
  function validAuthValue(value) {
    return classifyAuthValue(value) === 'valid';
  }
  function validVault(value) {
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      value.key === AUTH_KEY &&
      typeof value.revision === 'string' &&
      validAuthValue(value.value)
    );
  }
  root.__DSQUICK_AUTH_CONTRACT__ = Object.freeze({
    AUTH_KEY,
    classifyAuthValue,
    validAuthValue,
    validVault,
  });
})(globalThis);
