/* WealthMD — Store (store.js)
 * Centralized plan state with a small subscribe mechanism and
 * deep-merge hydration so persisted/saved plans can be loaded in.
 */
(function (global) {
  'use strict';

  function defaultState() {
    return {
      onboarded: false,
      age: 32,
      retirementAge: 62,
      income: 350000,
      filing: 'single',
      state: 'CA',
      city: '',
      deductions: { mode: 'standard', mortgage: 0, salt: 0, charity: 0, medical: 0 },
      match: { enabled: true, rateCents: 100, capPct: 4 },
      buckets: {
        trad401k: { balance: 0, contrib: 23500 },
        roth401k: { balance: 0, contrib: 0 },
        plan457: { balance: 0, contrib: 0 },
        rothIra: { balance: 0, contrib: 7000 },
        hsa: { balance: 0, contrib: 4300 },
        taxable: { balance: 0, contrib: 12000 },
        cash: { balance: 0, contrib: 6000 }
      },
      loans: { enabled: true, balance: 220000, rate: 6.5, payment: 24000 },
      projection: { returnPct: 7, years: 30 }
    };
  }

  const state = defaultState();
  const subscribers = [];

  /* Deep-merge a (partial) plan into the live state object IN PLACE so any
   * existing references to Store.state stay valid. */
  function mergeInto(target, src) {
    if (!src || typeof src !== 'object') return;
    Object.keys(src).forEach(function (k) {
      const sv = src[k];
      if (sv && typeof sv === 'object' && !Array.isArray(sv) &&
          target[k] && typeof target[k] === 'object') {
        mergeInto(target[k], sv);
      } else if (sv !== undefined) {
        target[k] = sv;
      }
    });
  }

  const Store = {
    state: state,
    getDefault: defaultState,

    /* Load a persisted/saved plan over the defaults. */
    hydrate: function (plan) { mergeInto(state, plan); },

    /* A plain, serializable snapshot of the current plan. */
    toPlan: function () { return JSON.parse(JSON.stringify(state)); },

    /* Reset everything back to factory defaults. */
    reset: function () { mergeInto(state, defaultState()); this.notify(); },

    subscribe: function (fn) {
      subscribers.push(fn);
      return function () {
        const i = subscribers.indexOf(fn);
        if (i >= 0) subscribers.splice(i, 1);
      };
    },
    notify: function () {
      for (let i = 0; i < subscribers.length; i++) subscribers[i](state);
    }
  };

  global.Store = Store;
})(typeof window !== 'undefined' ? window : this);
