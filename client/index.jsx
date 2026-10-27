/**
 * Client half of the Harness of Harness plugin.
 *
 * Registers the closed-by-default run panel as a right-Sidebar tab and a
 * conversation-header button that opens it. The panel is only registered when
 * the Host half answers that the panel is enabled.
 * @module dsh-plugin-harness-of-harness/client
 */

import { LOCALE_NAMESPACE } from '../src/contract.js';
import { HohPanel } from './app.jsx';
import { fetchConfig } from './data.js';
import { EN, ZH } from './locale.js';
import { installStyles } from './styles.js';
import { HohToggle } from './toggle.jsx';

/** Stable Cordis plugin name for the client half. */
export const name = 'harness-of-harness-panel';

/** Client services this half needs before it can register anything. */
export const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'];

/** This implementation's identity in the tab system, and the body's slot key. */
export const TAB_ID = 'dsh-plugin-harness-of-harness';

/** The page kind `openTab` names. */
export const TAB_KIND = 'hoh.run';

/**
 * Register the panel's tab type, body, and header entry point, once.
 * @param ctx - the client context.
 */
export function registerPanelUi(ctx) {
  const label = (key) => ctx.locale.resolveText({ zh: ZH[key] ?? key, en: EN[key] ?? key });

  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: TAB_KIND,
        priority: 'extension',
        title: () => 'Harness of Harness',
        guide: [
          {
            id: TAB_KIND,
            order: 43,
            title: () => label('guideTitle'),
            description: () => label('guideDescription'),
          },
        ],
      }),
    'harness-of-harness panel: tab type',
  );

  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          {
            name: 'sidebar.right.pane.tab',
            key: TAB_ID,
            locale: LOCALE_NAMESPACE,
          },
          HohPanel,
        ),
      ),
    'harness-of-harness panel: body',
  );

  ctx.effect(
    () =>
      ctx.slots.inject('conversation.session.header.actions', () =>
        ctx.slots.register(
          {
            name: 'conversation.session.header.actions',
            id: 'hoh-toggle',
            order: 16,
            locale: LOCALE_NAMESPACE,
            inject: () => ({ openPanel: () => ctx.sidebarRight.openTab(TAB_KIND) }),
          },
          HohToggle,
        ),
      ),
    'harness-of-harness panel: toggle',
  );
}

/**
 * Client plugin body: styles and dictionaries always, the panel only when the
 * Host says it is enabled.
 * @param ctx - the client context.
 */
export function apply(ctx) {
  ctx.effect(() => installStyles(), 'harness-of-harness panel: styles');
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, 'zh', ZH), 'harness-of-harness panel: zh');
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, 'en', EN), 'harness-of-harness panel: en');

  let settled = false;
  ctx.effect(
    () => () => {
      settled = true;
    },
    'harness-of-harness panel: lifecycle',
  );

  const register = () => {
    if (settled) return;
    settled = true;
    registerPanelUi(ctx);
  };

  fetchConfig().then(
    (config) => {
      if (config?.enabled) register();
    },
    (cause) => {
      // A definite "the panel is turned off" answer keeps the UI out. Any other
      // failure must not hide a working panel, so it registers and lets the
      // panel's own request report the problem.
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!/\(404\)|\(403\)/.test(message)) register();
    },
  );
}