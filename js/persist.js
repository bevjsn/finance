/* WealthMD — Persistence (persist.js)
 *
 * A storage adapter behind one small interface: load() / save() / clear().
 * Today it uses localStorage. A future Supabase (cloud login) adapter can
 * implement the SAME interface and drop in here with no changes to the pages.
 */
(function (global) {
  'use strict';

  const PLAN_KEY = 'wealthmd_plan';
  const SCENARIO_KEY = 'wealthmd_scenarios';
  const OLD_ONBOARD_KEY = 'wealthmd_onboard';   // pre-Phase-0 key, migrated on load
  const VERSION = 1;
  const SAVE_DEBOUNCE = 400;

  function storageAvailable() {
    try {
      const k = '__wmd_test__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  }

  /* Bring an older stored envelope up to the current schema version. */
  function migrate(envelope) {
    if (!envelope) return null;
    // tolerate both { version, plan } envelopes and bare plan objects
    let plan = envelope.plan ? envelope.plan : envelope;
    // (no version migrations needed yet; add `if (envelope.version < N)` here)
    return plan;
  }

  const LocalAdapter = {
    name: 'local',
    available: storageAvailable(),
    _timer: null,

    /* Debounced save so slider drags don't hammer localStorage. */
    save: function (plan) {
      if (!this.available) return;
      const self = this;
      if (this._timer) clearTimeout(this._timer);
      this._timer = setTimeout(function () { self.saveNow(plan); }, SAVE_DEBOUNCE);
    },

    saveNow: function (plan) {
      if (!this.available) return;
      try {
        localStorage.setItem(PLAN_KEY, JSON.stringify({
          version: VERSION, savedAt: Date.now(), plan: plan
        }));
      } catch (e) { /* quota / disabled — silently ignore */ }
    },

    load: function () {
      if (!this.available) return null;
      try {
        const raw = localStorage.getItem(PLAN_KEY);
        if (raw) return migrate(JSON.parse(raw));
        // one-time migration from the old onboarding-only key
        const old = localStorage.getItem(OLD_ONBOARD_KEY);
        if (old) {
          const o = JSON.parse(old);
          if (o && o.done) {
            return { age: o.age, retirementAge: o.retirementAge, onboarded: true };
          }
        }
      } catch (e) { /* corrupt data — start fresh */ }
      return null;
    },

    clear: function () {
      if (!this.available) return;
      try {
        localStorage.removeItem(PLAN_KEY);
        localStorage.removeItem(OLD_ONBOARD_KEY);
      } catch (e) { /* ignore */ }
    },

    /* ---- Named scenarios (save / list / delete) ---- */
    listScenarios: function () {
      if (!this.available) return [];
      try {
        const raw = localStorage.getItem(SCENARIO_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch (e) { return []; }
    },
    saveScenario: function (name, plan) {
      if (!this.available) return null;
      const list = this.listScenarios();
      const entry = {
        id: 'sc_' + Date.now().toString(36),
        name: name || 'Untitled',
        savedAt: Date.now(),
        plan: plan
      };
      list.push(entry);
      try { localStorage.setItem(SCENARIO_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
      return entry;
    },
    deleteScenario: function (id) {
      if (!this.available) return;
      const list = this.listScenarios().filter(function (s) { return s.id !== id; });
      try { localStorage.setItem(SCENARIO_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
    }
  };

  // The active adapter. Swap to a CloudAdapter here when login lands.
  const Persist = {
    VERSION: VERSION,
    adapter: LocalAdapter,
    available: LocalAdapter.available,
    save: function (plan) { return this.adapter.save(plan); },
    saveNow: function (plan) { return this.adapter.saveNow(plan); },
    load: function () { return this.adapter.load(); },
    clear: function () { return this.adapter.clear(); },
    listScenarios: function () { return this.adapter.listScenarios(); },
    saveScenario: function (name, plan) { return this.adapter.saveScenario(name, plan); },
    deleteScenario: function (id) { return this.adapter.deleteScenario(id); }
  };

  global.Persist = Persist;
})(typeof window !== 'undefined' ? window : this);
