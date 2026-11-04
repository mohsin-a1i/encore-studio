import { renderCreationBorder } from './creation-card.js';
import { renderIcon } from './icons.js';
import { escapeHtml } from './text-helpers.js';

export function renderEmptyState({ title, description, icon = 'note', action, heading = 'h3' }) {
  const tag = heading === 'h2' ? 'h2' : 'h3';
  const attributes = action
    ? ['action', 'view', 'id']
        .filter((key) => action[key] !== undefined)
        .map((key) => `data-${key}="${escapeHtml(action[key])}"`)
        .join(' ')
    : '';
  return /* HTML */ `
    <div class="empty-state">
      ${renderCreationBorder()}
      <span class="empty-state-graphic" aria-hidden="true">${renderIcon(icon)}</span>
      <div class="empty-state-copy heading-stack">
        <${tag} class="empty-state-title">${escapeHtml(title)}</${tag}>
        <p class="empty-state-description">${escapeHtml(description)}</p>
      </div>
      ${action ? `<button type="button" class="button secondary" ${attributes} ${action.management ? 'data-playlist-management-action' : ''}><span>${escapeHtml(action.label)}</span></button>` : ''}
    </div>
  `;
}
