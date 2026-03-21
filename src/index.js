import dotenv from 'dotenv';
dotenv.config();

import { fetch } from './primitives/fetch.js';
import { act } from './primitives/act.js';
import { authenticate, getSession, listSessions } from './primitives/authenticate.js';
import { sign, getAddress } from './primitives/sign.js';
import { persist, recall, forget, listKeys } from './primitives/persist.js';
import { observe } from './primitives/observe.js';
import { pay } from './primitives/pay.js';
import { see } from './primitives/see.js';
import { detectCaptcha, solveCaptcha } from './primitives/captcha.js';
import { importCookies, getExportInstructions } from './utils/cookie-import.js';
import { Router } from './router/router.js';
import pool from './browser.js';

/**
 * Reach — Agent Web Interface
 *
 * 9 primitives: fetch, act, authenticate, sign, persist, observe, pay, see, captcha
 * 1 router: picks the optimal interaction layer for each task
 * Utilities: cookie import, export instructions
 *
 * Usage:
 *   import { Reach } from './src/index.js';
 *   const reach = new Reach();
 *   const content = await reach.fetch('https://example.com');
 *   await reach.close();
 */
class Reach {
  constructor(options = {}) {
    this.router = new Router();
    this.options = options;

    if (options.wallet?.privateKey) {
      process.env.PRIVATE_KEY = options.wallet.privateKey;
    }
  }

  // --- Primitives ---

  async fetch(url, options = {}) {
    return fetch(url, options);
  }

  async act(url, action, params = {}) {
    return act(url, action, params);
  }

  async authenticate(service, method, credentials = {}) {
    return authenticate(service, method, credentials);
  }

  async sign(payload, options = {}) {
    return sign(payload, options);
  }

  persist(key, value, options = {}) {
    return persist(key, value, options);
  }

  recall(key) {
    return recall(key);
  }

  forget(key) {
    return forget(key);
  }

  // --- Vision ---

  async see(url, question) {
    return see(url, question);
  }

  // --- CAPTCHA ---

  async detectCaptcha(page) {
    return detectCaptcha(page);
  }

  async solveCaptcha(page) {
    return solveCaptcha(page);
  }

  // --- Cookie Import ---

  importCookies(service, filePath, format = 'auto') {
    return importCookies(service, filePath, format);
  }

  getExportInstructions(browser = 'chrome') {
    return getExportInstructions(browser);
  }

  // --- Convenience ---

  getAddress(privateKey) {
    return getAddress(privateKey);
  }

  getSession(service) {
    return getSession(service);
  }

  listSessions() {
    return listSessions();
  }

  listKeys() {
    return listKeys();
  }

  // --- Router ---

  route(task) {
    return this.router.route(task);
  }

  /**
   * Execute a task through the router.
   * The router picks the primitive, this method calls it.
   */
  async execute(task) {
    const plan = this.router.route(task);
    console.log(`[Reach] Route: ${plan.primitive}.${plan.method} via ${plan.layer} — ${plan.reason}`);

    switch (plan.primitive) {
      case 'fetch':
        return this.fetch(plan.params.url || task.url, plan.params);
      case 'act':
        return this.act(plan.params.url || task.url, task.params?.action, plan.params);
      case 'authenticate':
        return this.authenticate(plan.params.service, plan.params.method, plan.params.credentials);
      case 'sign':
        return this.sign(task.params?.payload, plan.params);
      case 'persist':
        if (plan.method === 'persist') return this.persist(task.params?.key, task.params?.value, plan.params);
        return this.recall(task.params?.key);
      case 'observe':
        return observe(task.url, task.params?.condition, task.params?.callback);
      case 'pay':
        return pay(task.params?.recipient, task.params?.amount, plan.params);
      default:
        throw new Error(`Unknown primitive: ${plan.primitive}`);
    }
  }

  /**
   * Teach the router about a site.
   */
  learnSite(url, info) {
    this.router.learnSite(url, info);
  }

  // --- Lifecycle ---

  async close() {
    await pool.close();
  }
}

export { Reach };
export default Reach;

// Also export individual primitives for direct use
export { fetch, act, authenticate, sign, persist, recall, forget, observe, pay, see };
export { detectCaptcha, solveCaptcha };
export { importCookies, getExportInstructions };
export { getAddress, getSession, listSessions, listKeys };
