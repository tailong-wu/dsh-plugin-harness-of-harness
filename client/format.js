/**
 * Small time helpers for the panel. Kept free of host imports so the bundle
 * stays standalone.
 * @module dsh-plugin-harness-of-harness/client/format
 */

/**
 * Render a duration between two epoch milliseconds.
 * @param from - the start instant.
 * @param to - the end instant; defaults to now.
 * @returns a compact `12s`, `3m 4s`, or `1h 5m` string.
 */
export function elapsed(from, to = Date.now()) {
  const seconds = Math.max(0, Math.round((to - from) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * Render a wall-clock instant.
 * @param ms - epoch milliseconds.
 * @returns the local time.
 */
export function clockTime(ms) {
  return new Date(ms).toLocaleTimeString();
}

/**
 * Substitute `{name}` placeholders in one copy string.
 * @param text - the copy string.
 * @param values - placeholder values.
 * @returns the filled string.
 */
export function fill(text, values) {
  return text.replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
}