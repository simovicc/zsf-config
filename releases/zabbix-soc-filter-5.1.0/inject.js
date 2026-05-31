(function () {
  'use strict';
  if (window.__socRefreshHook) return;
  window.__socRefreshHook = true;

  function isRefresh(s) {
    return typeof s === 'string' && s.indexOf('problem.view.refresh') !== -1;
  }

  function bodyToString(body) {
    try {
      if (typeof body === 'string') return body;
      if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
        return body.toString();
      }
    } catch (e) {}
    return null;
  }

  function bodyMatch(body) {
    const s = bodyToString(body);
    return s ? isRefresh(s) : false;
  }

  function fire(name) {
    try { document.dispatchEvent(new CustomEvent(name)); } catch (e) {}
  }

  function store(method, url, body) {
    try {
      const payload = JSON.stringify({
        m: (method || 'POST').toUpperCase(),
        u: url || '',
        b: bodyToString(body)
      });
      if (document.documentElement) {
        document.documentElement.setAttribute('data-soc-refresh-req', payload);
      }
    } catch (e) {}
  }

  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const origOpen = XHR.prototype.open;
    const origSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      try { this.__socUrl = url || ''; this.__socMethod = method || 'POST'; } catch (e) {}
      return origOpen.apply(this, arguments);
    };

    XHR.prototype.send = function (body) {
      let refresh = false;
      try { refresh = isRefresh(this.__socUrl) || bodyMatch(body); } catch (e) {}
      if (refresh) {
        try { store(this.__socMethod, this.__socUrl, body); } catch (e) {}
        fire('soc-refresh-start');
        try {
          this.addEventListener('loadend', function () { fire('soc-refresh-end'); });
        } catch (e) {}
      }
      return origSend.apply(this, arguments);
    };
  }

  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      let url = '';
      try { url = (typeof input === 'string') ? input : (input && input.url) || ''; } catch (e) {}
      const body = init && init.body;
      const method = (init && init.method) || (input && input.method) || 'GET';
      const refresh = isRefresh(url) || bodyMatch(body);
      if (refresh) {
        try { store(method, url, body); } catch (e) {}
        fire('soc-refresh-start');
      }
      const p = origFetch.apply(this, arguments);
      if (refresh && p && typeof p.then === 'function') {
        p.then(function () { fire('soc-refresh-end'); }, function () { fire('soc-refresh-end'); });
      }
      return p;
    };
  }
})();
