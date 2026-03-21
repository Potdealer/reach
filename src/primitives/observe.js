/**
 * Monitoring primitive. Watches targets for conditions.
 * STUB — not yet implemented.
 *
 * @param {string} target - URL or selector to watch
 * @param {object} condition - What to watch for
 * @param {function} callback - Called when condition is met
 * @returns {object} Observer handle
 */
export async function observe(target, condition, callback) {
  console.log(`[observe] Not yet implemented. Target: ${target}`);
  console.log('[observe] Future: poll-based monitoring, WebSocket watchers, DOM mutation observers');

  return {
    id: `obs-${Date.now()}`,
    target,
    condition,
    status: 'stub',
    stop: () => console.log('[observe] Stopped (stub)'),
  };
}
