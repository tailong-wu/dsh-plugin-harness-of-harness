/**
 * Host half of the Harness of Harness panel: the Fetch routes the right-Sidebar
 * tab reads and writes.
 *
 * The routes are registered through a dynamic `connection` injection rather
 * than the plugin's static `inject` list, because a headless composition has no
 * web surface and must still load the plugin.
 * @module dsh-plugin-harness-of-harness/panel
 */

import { CONFIG_PATH, START_PATH, STATE_PATH, STOP_PATH } from './contract.js';

/**
 * Serialize one payload as a cache-free JSON response.
 * @param body - the payload.
 * @param status - the HTTP status.
 * @returns the response.
 */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/**
 * Read a JSON request body, treating an empty body as `{}`.
 * @param request - the incoming request.
 * @returns the parsed body.
 */
async function readBody(request) {
  try {
    const text = await request.text();
    if (text.trim() === '') return {};
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new Error('The request body was not valid JSON.');
  }
}

/**
 * Turn a thrown value into a response the panel can explain.
 * @param error - the thrown value.
 * @returns the response.
 */
function failureResponse(error) {
  const message = error instanceof Error ? error.message : String(error);
  const status = /already active/i.test(message) ? 409 : 400;
  return jsonResponse({ error: message }, status);
}

/**
 * Register the panel's routes when a web connection exists.
 * @param ctx - the plugin context.
 * @param engine - the run engine.
 * @param enabled - whether the panel is enabled for this profile.
 */
export function registerPanelRoutes(ctx, engine, enabled) {
  ctx.inject(['connection'], (connected) => {
    const connection = connected.connection;

    connection.fetch.register({
      path: CONFIG_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () =>
        jsonResponse({
          enabled,
          defaults: engine.defaults(),
        }),
    });

    connection.fetch.register({
      path: STATE_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const session = new URL(request.url).searchParams.get('session') ?? undefined;
        return jsonResponse({ enabled, run: engine.read(session), defaults: engine.defaults() });
      },
    });

    connection.fetch.register({
      path: START_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = await readBody(request);
          const run = engine.start({
            sessionId: body.sessionId,
            goal: body.goal,
            projectDir: body.projectDir,
            iterations: body.iterations,
          });
          return jsonResponse({ run });
        } catch (error) {
          return failureResponse(error);
        }
      },
    });

    connection.fetch.register({
      path: STOP_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = await readBody(request);
          const outcome = engine.stop({ sessionId: body.sessionId });
          return jsonResponse(outcome);
        } catch (error) {
          return failureResponse(error);
        }
      },
    });
  });
}