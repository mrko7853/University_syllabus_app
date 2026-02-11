const rawBaseUrl = import.meta.env.BASE_URL || '/';

function normalizeBasePath(baseUrl) {
  const sanitized = String(baseUrl || '/').replace(/\/+$/, '');
  return sanitized === '' ? '' : sanitized;
}

export const APP_BASE_PATH = normalizeBasePath(rawBaseUrl);

export function withBase(path = '/') {
  if (!path) return APP_BASE_PATH ? `${APP_BASE_PATH}/` : '/';

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  if (path.startsWith('#') || path.startsWith('?')) {
    return path;
  }

  let normalizedPath = path.startsWith('/') ? path : `/${path}`;

  if (APP_BASE_PATH && (normalizedPath === APP_BASE_PATH || normalizedPath.startsWith(`${APP_BASE_PATH}/`))) {
    return normalizedPath;
  }

  if (!APP_BASE_PATH) {
    return normalizedPath;
  }

  if (normalizedPath === '/') {
    return `${APP_BASE_PATH}/`;
  }

  return `${APP_BASE_PATH}${normalizedPath}`;
}

export function stripBase(pathname = '/') {
  let normalizedPath = String(pathname || '/');

  if (/^https?:\/\//i.test(normalizedPath)) {
    const url = new URL(normalizedPath);
    normalizedPath = `${url.pathname}${url.search}${url.hash}`;
  }

  const noHash = normalizedPath.split('#')[0];
  const [pathOnly] = noHash.split('?');
  const safePath = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;

  if (!APP_BASE_PATH) {
    return safePath || '/';
  }

  if (safePath === APP_BASE_PATH) {
    return '/';
  }

  if (safePath.startsWith(`${APP_BASE_PATH}/`)) {
    return safePath.slice(APP_BASE_PATH.length) || '/';
  }

  return safePath || '/';
}

export function getCurrentAppPath() {
  return stripBase(window.location.pathname);
}

export function toAppUrl(path = '/') {
  return `${window.location.origin}${withBase(path)}`;
}
