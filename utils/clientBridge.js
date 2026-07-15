(function () {
  const DEFAULT_PORT = 3000;
  const PREFERRED_HOST = '127.0.0.1';

  function buildBaseUrl() {
    if (window.location.protocol === 'file:') {
      return `http://${PREFERRED_HOST}:${DEFAULT_PORT}`;
    }
    if (window.location.origin && window.location.origin !== 'null') {
      return window.location.origin;
    }
    return `http://${PREFERRED_HOST}:${DEFAULT_PORT}`;
  }

  const APP_BASE_URL = buildBaseUrl();
  window.APP_BASE_URL = APP_BASE_URL;

  window.getApiUrl = function (path) {
    if (!path) return APP_BASE_URL;
    if (typeof path !== 'string') return path;
    if (/^https?:\/\//i.test(path)) return path;
    return APP_BASE_URL + (path.startsWith('/') ? path : '/' + path);
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = function (resource, init) {
    if (typeof resource === 'string') {
      if (resource.startsWith('/api')) {
        resource = APP_BASE_URL + resource;
      }
    } else if (resource instanceof Request && resource.url.startsWith('/api')) {
      resource = new Request(APP_BASE_URL + resource.url, resource);
    }
    return originalFetch(resource, init);
  };

  function normalizeFormActions() {
    if (window.location.protocol !== 'file:') return;
    const forms = document.querySelectorAll('form[action^="/api"]');
    forms.forEach(form => {
      form.action = APP_BASE_URL + form.getAttribute('action');
    });
  }

  function showFileProtocolWarning() {
    if (window.location.protocol !== 'file:') return;
    const warning = document.createElement('div');
    warning.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;padding:12px 16px;background:rgba(255,165,0,0.95);color:#000;font-size:13px;font-family:sans-serif;text-align:center;backdrop-filter:blur(6px);';
    warning.innerHTML = 'You are viewing this page with <strong>file://</strong>. API calls will be redirected to <strong>' + APP_BASE_URL + '</strong>. If server is not running, open the app via <strong>' + APP_BASE_URL + '</strong> instead.';
    document.body.appendChild(warning);
  }

  window.addEventListener('DOMContentLoaded', () => {
    normalizeFormActions();
    showFileProtocolWarning();
  });
})();
