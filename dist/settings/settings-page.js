import { studioState } from '../app/browser-state.js';
import {
  connectionServices,
  isServiceConnected,
  getServiceStatus,
  allServicesConnected,
} from './connection-status.js';
import { renderIcon } from '../app/icons.js';
import { themes, defaultTheme, getSelectedThemeId, getThemeInfo } from './color-themes.js';
import { escapeHtml } from '../app/text-helpers.js';

function getThemeStatusText() {
  const selected = themes.find((theme) => theme.id === getSelectedThemeId());
  if (selected.id !== 'magic') return `${selected.name} is your current dark theme.`;
  const info = getThemeInfo();
  if (info.status === 'ready') return `Magic chose ${info.theme} for “${info.title}”.`;
  if (info.status === 'loading') return `Finding the colors in “${info.title}”…`;
  if (info.status === 'unavailable')
    return `Cover colors are unavailable. Magic is using ${defaultTheme.name} for now.`;
  return 'Play a song and Magic will choose a matching theme.';
}

function renderAppearanceSettings() {
  return /* HTML */ `
    <fieldset class="settings-appearance" aria-describedby="theme-help">
      <legend>Appearance</legend>
      <p id="theme-help">Every shade stays dark. Choose your palette, or let the music choose.</p>
      <div class="theme-options">
        ${themes
          .map((theme) => {
            const magic = theme.id === 'magic';
            const preview = magic
              ? ''
              : `--preview-panel:hsl(${theme.hue} ${theme.saturation === 0 ? 0 : 42}% 10%);--preview-accent:${theme.fill}`;
            return /* HTML */ `
              <label class="theme-option ${magic ? 'theme-option-magic' : ''}" style="${preview}">
                <input
                  type="radio"
                  name="studio-theme"
                  value="${theme.id}"
                  ${getSelectedThemeId() === theme.id ? 'checked' : ''}
                  aria-labelledby="theme-${theme.id}-name"
                  aria-describedby="theme-${theme.id}-description"
                />
                <span class="theme-choice">
                  <span
                    class="theme-preview ${magic ? 'theme-preview-magic' : ''}"
                    aria-hidden="true"
                  >
                    <span class="theme-preview-sidebar"></span>
                    <span class="theme-preview-content">
                      <i></i>
                      <i></i>
                      <i></i>
                    </span>
                    ${magic ? renderIcon('spark') : ''}
                  </span>
                  <span class="theme-choice-copy heading-stack">
                    <span class="theme-choice-title" id="theme-${theme.id}-name">
                      <span>${theme.name}</span>
                      ${renderIcon('check', 'theme-choice-check sm')}
                    </span>
                    <span class="theme-choice-description" id="theme-${theme.id}-description">
                      ${theme.description}
                    </span>
                  </span>
                </span>
              </label>
            `;
          })
          .join('')}
      </div>
      <p class="theme-selection-status" data-theme-status role="status" aria-live="polite">
        ${escapeHtml(getThemeStatusText())}
      </p>
    </fieldset>
  `;
}

export function updateThemeSettings() {
  const status = document.querySelector('[data-theme-status]');
  if (status) status.textContent = getThemeStatusText();
}

const details = {
  studio: {
    icon: 'library',
    description: 'Stores songs, profiles, and playlists.',
  },
  codex: {
    icon: 'spark',
    description: 'Writes song titles, styles, and lyrics.',
  },
  comfy: {
    icon: 'note',
    description: 'Renders songs and transcribes reference audio.',
  },
};

function getConnectionStatusKind(id) {
  if (studioState.connectionChecks.has(id)) return 'checking';
  if (isServiceConnected(id)) return 'online';
  return getServiceStatus(id) === 'Not checked' ? 'unknown' : 'offline';
}

export function renderSettingsPage() {
  const count = connectionServices.filter(({ id }) => isServiceConnected(id)).length;
  return /* HTML */ `
    <div id="settings-page" class="settings-page">
      <div class="page-intro">
        <div>
          <div class="eyebrow">YOUR WORKSPACE</div>
          <h1 id="settings-title" tabindex="-1">Settings</h1>
          <p>Make yourself at home. Set the look and keep your music connected.</p>
        </div>
      </div>
      ${renderAppearanceSettings()}
      <section class="settings-connections" aria-labelledby="connections-heading">
        <div class="settings-section-heading">
          <h2 id="connections-heading">Connections</h2>
          <span class="settings-connected-count">
            <span data-connected-count>${count}</span>
            <span>/ 3 online</span>
          </span>
        </div>
        <p class="settings-section-description">Manage the services behind your music.</p>
        <div class="settings-services">
          ${connectionServices
            .map(({ id, name }) => {
              const info = details[id];
              const checking = studioState.connectionChecks.has(id);
              return /* HTML */ `
                <article
                  class="settings-service"
                  data-connection-service="${id}"
                  data-status="${getConnectionStatusKind(id)}"
                  aria-labelledby="${id}-heading"
                >
                  <div class="settings-service-header">
                    <span class="settings-service-icon">${renderIcon(info.icon)}</span>
                    <div class="heading-stack">
                      <h3 id="${id}-heading">${name}</h3>
                      <span class="settings-status">
                        <i aria-hidden="true"></i>
                        <span data-status-text role="status" aria-live="polite">
                          ${getServiceStatus(id)}
                        </span>
                      </span>
                    </div>
                  </div>
                  <p class="settings-service-description" id="${id}-description">
                    ${info.description}
                  </p>
                  <button
                    class="button secondary settings-check"
                    data-action="retry-connection"
                    data-service="${id}"
                    aria-label="${isServiceConnected(id) ? 'Verify' : 'Retry'} ${name} connection"
                    aria-describedby="${id}-description"
                    aria-disabled="${checking}"
                    aria-busy="${checking}"
                  >
                    ${renderIcon('repeat', 'sm')}
                    <span data-check-label>
                      ${checking ? 'Checking…' : isServiceConnected(id) ? 'Verify' : 'Retry'}
                    </span>
                  </button>
                </article>
              `;
            })
            .join('')}
        </div>
      </section>
      <p class="settings-footnote">Checks verify availability without restarting services.</p>
    </div>
  `;
}

// Update in place so a running check never replaces the focused control.
export function refreshSettingsPage() {
  document
    .querySelector('.nav-connection .dot')
    ?.classList.toggle('online', allServicesConnected());
  const page = document.querySelector('#settings-page');
  if (!page) return;
  page.querySelector('[data-connected-count]').textContent = connectionServices.filter(({ id }) =>
    isServiceConnected(id),
  ).length;
  for (const { id, name } of connectionServices) {
    const row = page.querySelector(`[data-connection-service="${id}"]`);
    const checking = studioState.connectionChecks.has(id);
    row.dataset.status = getConnectionStatusKind(id);
    row.querySelector('[data-status-text]').textContent = getServiceStatus(id);
    const button = row.querySelector('[data-action="retry-connection"]');
    button.setAttribute('aria-disabled', String(checking));
    button.setAttribute('aria-busy', String(checking));
    button.setAttribute(
      'aria-label',
      `${isServiceConnected(id) ? 'Verify' : 'Retry'} ${name} connection`,
    );
    button.querySelector('[data-check-label]').textContent = checking
      ? 'Checking…'
      : isServiceConnected(id)
        ? 'Verify'
        : 'Retry';
  }
}
