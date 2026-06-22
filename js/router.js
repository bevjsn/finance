/* WealthMD — Hash router (router.js)
 * Maps location.hash to a page: toggles the matching [data-page] section and
 * [data-route] tab, then fires onChange(pageKey). Keeps the app a single
 * page with deep-linkable, back/forward-friendly URLs.
 */
(function (global) {
  'use strict';

  const routes = {};        // path -> pageKey
  let current = '';
  let onChange = null;
  let fallback = '/';

  function pageKeyFor(path) {
    return routes[path] || routes[fallback];
  }

  function apply() {
    let path = (location.hash || '').replace(/^#/, '');
    if (!routes[path]) path = fallback;
    current = path;
    const key = pageKeyFor(path);

    document.querySelectorAll('[data-page]').forEach(function (sec) {
      sec.classList.toggle('active', sec.getAttribute('data-page') === key);
    });
    document.querySelectorAll('[data-route]').forEach(function (tab) {
      tab.classList.toggle('active', tab.getAttribute('data-route') === path);
    });

    if (onChange) onChange(key, path);
  }

  const Router = {
    /* routeMap: { '/': 'overview', '/taxes': 'taxes', ... } */
    start: function (routeMap, defaultPath, changeHandler) {
      Object.keys(routeMap).forEach(function (p) { routes[p] = routeMap[p]; });
      fallback = defaultPath || '/';
      onChange = changeHandler || null;
      window.addEventListener('hashchange', apply);
      apply();
    },
    current: function () { return current; },
    currentPage: function () { return pageKeyFor(current); },
    go: function (path) { location.hash = path; }
  };

  global.Router = Router;
})(typeof window !== 'undefined' ? window : this);
