/**
 * The conversation-header action that opens the Harness of Harness panel.
 *
 * It is the panel's second entry point beside the Sidebar tab picker, so the
 * mode is reachable from the conversation the run is parented to. It renders a
 * plain themed button whose metrics copy the shipped `Button` (`sm` + `ghost`)
 * so it lines up with the built-in header actions beside it; a panel imports no
 * Harness Client package.
 * @module dsh-plugin-harness-of-harness/client/toggle
 */

import { EN } from './locale.js';

/**
 * The panel's header glyph: one harness inside another.
 * @returns the icon.
 */
function LoopGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="3" stroke="currentColor" strokeWidth="1.3" />
      <rect x="5" y="5" width="6" height="6" rx="1.6" stroke="currentColor" strokeWidth="1.3" opacity="0.75" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" />
    </svg>
  );
}

/**
 * Render the header toggle.
 * @param props - the injected opener and translator.
 * @returns the button anchored in the conversation header.
 */
export function HohToggle({ openPanel, t }) {
  const translate = (key) => (typeof t === 'function' ? t(key) : EN[key] ?? key);
  const label = translate('open');
  return (
    <button
      type="button"
      className="hoh-header-button"
      title={label}
      aria-label={label}
      onClick={openPanel}
    >
      <span className="hoh-header-icon">
        <LoopGlyph />
      </span>
      <span className="hoh-header-label">{translate('button')}</span>
    </button>
  );
}