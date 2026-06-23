/* Attending Launch — Cloud sync (cloud.js)
 *
 * Optional Supabase-backed login + cross-device sync, layered on top of the
 * local-first store. Everything degrades gracefully: if Supabase isn't
 * configured (or the SDK didn't load), the app stays fully usable local-only.
 *
 * Model: one row per user in table `al_data(user_id, plan jsonb,
 * scenarios jsonb, updated_at)`. We mirror localStorage <-> that row.
 * See CLOUD_SETUP.md for the 3-step setup.
 */
(function (global) {
  'use strict';

  const CONFIG_KEY = 'al_supabase';   // { url, anonKey } stored locally
  const TABLE = 'al_data';
  const PUSH_DEBOUNCE = 1500;

  let client = null;
  let session = null;
  let applying = false;     // true while writing cloud data into local (suppress push)
  let pushTimer = null;
  let onStatus = null;

  function getConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    if (global.AL_CONFIG && global.AL_CONFIG.supabaseUrl) {
      return { url: global.AL_CONFIG.supabaseUrl, anonKey: global.AL_CONFIG.supabaseAnonKey };
    }
    return null;
  }
  function setConfig(url, anonKey) {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify({ url: url, anonKey: anonKey })); } catch (e) { /* ignore */ }
  }
  function configured() { const c = getConfig(); return !!(c && c.url && c.anonKey); }
  function sdkLoaded() { return !!(global.supabase && global.supabase.createClient); }

  function initClient() {
    if (client) return client;
    if (!sdkLoaded() || !configured()) return null;
    const c = getConfig();
    try { client = global.supabase.createClient(c.url, c.anonKey); } catch (e) { client = null; }
    return client;
  }

  function status() {
    return {
      sdk: sdkLoaded(),
      configured: configured(),
      signedIn: !!session,
      email: session && session.user ? session.user.email : null
    };
  }
  function emit() { if (onStatus) onStatus(status()); }

  function init(statusCb) {
    onStatus = statusCb || null;
    if (!sdkLoaded() || !configured()) { emit(); return; }
    const cl = initClient();
    if (!cl) { emit(); return; }
    cl.auth.getSession().then(function (res) {
      session = res && res.data ? res.data.session : null;
      cl.auth.onAuthStateChange(function (_evt, s) {
        session = s;
        emit();
        if (s) pull();
      });
      emit();
      if (session) pull();
    }).catch(function () { emit(); });
  }

  function signIn(email) {
    const cl = initClient();
    if (!cl) return Promise.reject(new Error('Cloud sync is not set up yet.'));
    const redirect = global.location.origin + global.location.pathname;
    return cl.auth.signInWithOtp({ email: email, options: { emailRedirectTo: redirect } })
      .then(function (res) { if (res.error) throw res.error; return true; });
  }

  function signOut() {
    const cl = initClient();
    const done = cl ? cl.auth.signOut() : Promise.resolve();
    return done.then(function () { session = null; emit(); });
  }

  /* Pull the user's cloud row into local + Store; if cloud is empty, seed it. */
  function pull() {
    const cl = initClient();
    if (!cl || !session) return Promise.resolve();
    return cl.from(TABLE).select('plan,scenarios,updated_at')
      .eq('user_id', session.user.id).maybeSingle()
      .then(function (res) {
        if (res.error) { console.warn('cloud pull:', res.error.message); return; }
        const data = res.data;
        applying = true;
        try {
          if (data && data.plan) {
            if (global.Store) global.Store.hydrate(data.plan);
            if (global.Persist) global.Persist.saveNow(data.plan);
            if (data.scenarios && global.Persist) global.Persist.replaceScenarios(data.scenarios);
            if (global.AppUI && global.AppUI.reload) global.AppUI.reload();
          } else {
            pushNow();   // first sign-in on this account — seed cloud from local
          }
        } finally { applying = false; }
        emit();
      })
      .catch(function (e) { console.warn('cloud pull failed:', e); });
  }

  function schedulePush() {
    if (applying || !session) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, PUSH_DEBOUNCE);
  }

  function pushNow() {
    const cl = initClient();
    if (!cl || !session) return Promise.resolve();
    const plan = global.Persist ? global.Persist.load() : null;
    const scenarios = global.Persist ? global.Persist.listScenarios() : [];
    return cl.from(TABLE).upsert({
      user_id: session.user.id,
      plan: plan,
      scenarios: scenarios,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' }).then(function (res) {
      if (res.error) console.warn('cloud push:', res.error.message);
    }).catch(function (e) { console.warn('cloud push failed:', e); });
  }

  global.Cloud = {
    init: init,
    signIn: signIn,
    signOut: signOut,
    setConfig: setConfig,
    getConfig: getConfig,
    configured: configured,
    sdkLoaded: sdkLoaded,
    status: status,
    schedulePush: schedulePush,
    pull: pull
  };
})(typeof window !== 'undefined' ? window : this);
