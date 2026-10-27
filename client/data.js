/**
 * Browser-side reads and writes of the host's Harness of Harness routes.
 *
 * The routes sit behind the same `/api` trust fence and session cookie as the
 * rest of the client, so a same-origin fetch with credentials is enough.
 * @module dsh-plugin-harness-of-harness/client/data
 */

import { CONFIG_PATH, START_PATH, STATE_PATH, STOP_PATH } from '../src/contract.js';

/**
 * Read the failure message out of a rejected response.
 * @param response - the failed response.
 * @returns the message to show.
 */
async function readError(response) {
  try {
    const body = await response.json();
    if (body !== null && typeof body.error === 'string' && body.error !== '') return body.error;
  } catch {
    // Fall through to the status line.
  }
  return `Harness of Harness request failed (${response.status}).`;
}

/**
 * Read the panel configuration and its defaults.
 * @param signal - caller cancellation.
 * @returns the host's answer.
 */
export async function fetchConfig(signal) {
  const response = await fetch(CONFIG_PATH, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

/**
 * Read the run belonging to one session.
 * @param sessionId - the session that owns the panel, when known.
 * @param signal - caller cancellation.
 * @returns the run payload.
 */
export async function fetchState(sessionId, signal) {
  const query = sessionId === undefined || sessionId === '' ? '' : `?session=${encodeURIComponent(sessionId)}`;
  const response = await fetch(`${STATE_PATH}${query}`, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

/**
 * Admit a run.
 * @param request - the run request.
 * @param signal - caller cancellation.
 * @returns the admitted run.
 */
export async function startRun(request, signal) {
  const response = await fetch(START_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

/**
 * Stop the session's active run.
 * @param sessionId - the session that owns the panel, when known.
 * @param signal - caller cancellation.
 * @returns the stop outcome.
 */
export async function stopRun(sessionId, signal) {
  const response = await fetch(STOP_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}