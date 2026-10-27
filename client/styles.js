/**
 * Panel stylesheet, installed once and removed on unload.
 *
 * Containers and controls inherit the host theme tokens; only the role accents
 * carry colors of their own.
 * @module dsh-plugin-harness-of-harness/client/styles
 */

const STYLE_ID = 'hoh-panel-styles';

/** The panel's stylesheet. */
const CSS = `
.hoh-root {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  min-height: 100%;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary, inherit);
  overflow-y: auto;
}
.hoh-head { display: flex; flex-direction: column; gap: 2px; }
.hoh-title { font-size: 14px; font-weight: 600; }
.hoh-sub { color: var(--dsw-alias-label-secondary, inherit); font-size: 11px; }
.hoh-chip {
  display: inline-flex; align-items: center; gap: 6px;
  align-self: flex-start;
  padding: 2px 8px; border-radius: 999px; font-size: 11px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35));
  color: var(--dsw-alias-label-secondary, inherit);
}
.hoh-chip[data-status="running"], .hoh-chip[data-status="stopping"] { color: var(--dsw-alias-brand-primary, inherit); }
.hoh-chip[data-status="done"] { color: var(--dsw-alias-state-success-primary, inherit); }
.hoh-chip[data-status="error"] { color: var(--dsw-alias-state-error-primary, inherit); }
.hoh-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.hoh-card {
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35));
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  padding: 10px;
  display: flex; flex-direction: column; gap: 8px;
}
.hoh-field { display: flex; flex-direction: column; gap: 4px; }
.hoh-label { font-size: 11px; color: var(--dsw-alias-label-secondary, inherit); }
.hoh-input, .hoh-textarea {
  width: 100%; box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35));
  border-radius: 6px;
  background: var(--dsw-alias-bg-base, transparent);
  color: inherit; font: inherit; padding: 6px 8px;
}
.hoh-textarea { min-height: 88px; resize: vertical; }
.hoh-input:focus, .hoh-textarea:focus { outline: 1px solid var(--dsw-alias-brand-primary, currentColor); }
.hoh-row { display: flex; align-items: center; gap: 8px; }
.hoh-actions { display: flex; gap: 8px; }
.hoh-button {
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35));
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2, transparent);
  color: inherit; font: inherit; padding: 5px 10px; cursor: pointer;
}
.hoh-button:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2, currentColor); }
.hoh-button:disabled { opacity: .5; cursor: default; }
.hoh-button[data-primary="true"] {
  border-color: var(--dsw-alias-brand-primary, currentColor);
  color: var(--dsw-alias-brand-primary, inherit);
}
.hoh-pipeline { display: flex; flex-direction: column; gap: 6px; }
.hoh-step {
  display: grid; grid-template-columns: 14px 1fr auto; align-items: baseline;
  gap: 8px; padding: 6px 8px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35));
}
.hoh-step[data-state="running"] { border-color: var(--dsw-alias-brand-primary, currentColor); }
.hoh-step[data-state="failed"] { border-color: var(--dsw-alias-state-error-primary, currentColor); }
.hoh-step-name { font-weight: 600; }
.hoh-step-state { color: var(--dsw-alias-label-secondary, inherit); font-size: 11px; white-space: nowrap; }
.hoh-summary {
  grid-column: 2 / 4;
  white-space: pre-wrap; word-break: break-word;
  color: var(--dsw-alias-label-secondary, inherit);
  font-size: 11px;
  max-height: 9em; overflow: auto;
}
.hoh-meta { color: var(--dsw-alias-label-secondary, inherit); font-size: 11px; word-break: break-all; }
.hoh-link { color: var(--dsw-alias-brand-primary, inherit); text-decoration: none; }
.hoh-link:hover { text-decoration: underline; }
.hoh-log {
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35));
  border-radius: 8px; padding: 8px;
  max-height: 180px; overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
}
.hoh-log-line { display: flex; gap: 8px; }
.hoh-log-time { color: var(--dsw-alias-label-secondary, inherit); white-space: nowrap; }
.hoh-log-line[data-level="warn"] { color: var(--dsw-alias-state-warn-primary, inherit); }
.hoh-log-line[data-level="error"] { color: var(--dsw-alias-state-error-primary, inherit); }
.hoh-iteration { display: flex; flex-direction: column; gap: 4px; padding: 8px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35)); }
.hoh-iteration-head { display: flex; justify-content: space-between; gap: 8px; font-weight: 600; }
/* Mirrors the shipped Button small+ghost metrics exactly, so this header action
 * is indistinguishable in size from one built on the primitive: the base is
 * 14px/22px, the small size is 12px/18px and 28px tall with 0 10px padding, a
 * 4px gap and no border. Values come from
 * @deepseek-ai/dsh-client-ui-primitives/lib/Button.module.css. */
.hoh-header-button {
  box-sizing: border-box;
  display: inline-flex; align-items: center; justify-content: center;
  gap: 4px; height: 28px; padding: 0 10px;
  border: none; border-radius: var(--dsw-radius-sm, 8px);
  background: transparent; cursor: pointer;
  font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-primary, inherit);
}
.hoh-header-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
.hoh-header-button:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active, rgba(127,127,127,.18)); }
.hoh-header-button:disabled { cursor: not-allowed; opacity: .4; }
.hoh-header-button:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary, currentColor); }
.hoh-header-icon { display: inline-flex; width: 16px; height: 16px; align-items: center; justify-content: center; }

/* The conversation header runs out of room on narrow viewports; the label
 * collapses to the icon, matching the Dayflow action beside it. */
@media (max-width: 720px) {
  .hoh-header-label { display: none; }
  .hoh-header-button { padding: 0 6px; }
}
.hoh-banner { border-radius: 6px; padding: 8px; border: 1px solid; }
.hoh-banner[data-kind="error"] { border-color: var(--dsw-alias-state-error-primary, currentColor); color: var(--dsw-alias-state-error-primary, inherit); }
.hoh-banner[data-kind="empty"] { border-color: var(--dsw-alias-border-l1, rgba(127,127,127,.35)); color: var(--dsw-alias-label-secondary, inherit); }
`;

/**
 * Install the stylesheet once.
 * @returns a cleanup that removes it.
 */
export function installStyles() {
  if (document.getElementById(STYLE_ID) !== null) return () => {};
  const element = document.createElement('style');
  element.id = STYLE_ID;
  element.textContent = CSS;
  document.head.appendChild(element);
  return () => {
    element.remove();
  };
}