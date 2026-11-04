import { modalRoot, studioState } from '../app/browser-state.js';
import { escapeHtml } from '../app/text-helpers.js';
import { renderIcon } from '../app/icons.js';
import { openDialog } from '../library/library-dialogs.js';
import { bindProfileMenus } from './profile-menus.js';

function renderProfileMenu(profile, key) {
  return `<div class="profile-card-menu">
    <button type="button" class="icon-button profile-menu-toggle" data-profile-menu-toggle aria-label="Options for ${escapeHtml(profile.name)}" aria-haspopup="menu" aria-expanded="false" aria-controls="profile-options-${key}" title="Profile options">${renderIcon('more')}</button>
    <div id="profile-options-${key}" class="profile-menu" role="menu" aria-label="Actions for ${escapeHtml(profile.name)}" hidden>
      <button type="button" role="menuitem" tabindex="-1" data-action="profile-rename" data-id="${escapeHtml(profile.id)}">${renderIcon('edit', 'sm')}<span>Edit</span></button>
      <button type="button" role="menuitem" tabindex="-1" data-action="profile-delete" data-id="${escapeHtml(profile.id)}">${renderIcon('trash', 'sm')}<span>Delete</span></button>
    </div>
  </div>`;
}

function renderProfileAvatar(profile, className = '') {
  return `<span class="avatar ${className}" aria-hidden="true">${escapeHtml(Array.from(profile.name)[0]?.toUpperCase() || '?')}</span>`;
}

export function openProfiles() {
  const current =
    studioState.profiles.find((profile) => profile.id === studioState.profileId) ||
    studioState.profile;
  const others = studioState.profiles.filter((profile) => profile.id !== current.id);
  openDialog(
    'Your profiles',
    `<section class="profile-current profile-row" aria-label="Current profile" data-current-profile>
      ${renderProfileMenu(current, 'current')}
      ${renderProfileAvatar(current, 'profile-current-avatar')}
      <div class="profile-current-copy heading-stack">
        <h3 class="profile-greeting" dir="auto">Hi, ${escapeHtml(current.name)}</h3>
        <p class="profile-current-status">Current profile</p>
      </div>
    </section>
    ${
      others.length
        ? `<section class="profile-switcher" aria-labelledby="profile-switch-heading">
      <h3 id="profile-switch-heading">Switch profile</h3>
      <div class="profile-list">${others
        .map(
          (profile, index) => `
        <div class="profile-row">
          <button type="button" class="profile-choice" data-action="profile-switch" data-id="${escapeHtml(profile.id)}" aria-label="Switch to ${escapeHtml(profile.name)}">
            ${renderProfileAvatar(profile)}
            <span class="profile-switch-copy heading-stack">
              <strong dir="auto" title="${escapeHtml(profile.name)}">${escapeHtml(profile.name)}</strong>
              <small>Switch to this profile</small>
            </span>
          </button>
          ${renderProfileMenu(profile, index)}
        </div>`,
        )
        .join('')}
      </div>
    </section>`
        : ''
    }
    <button type="button" class="profile-add button secondary" data-action="profile-create">${renderIcon('plus')}<span>Add profile</span></button>`,
    '',
    false,
    { className: 'profiles-modal', overlayClassName: 'profiles-overlay' },
  );
  studioState.modal = { kind: 'profiles' };
  const dialog = modalRoot.querySelector('.profiles-modal');
  if (dialog) bindProfileMenus(dialog);
}

export function openProfileForm(id) {
  const profile = studioState.profiles.find((item) => item.id === id);
  openDialog(
    profile ? 'Edit profile' : 'New profile',
    `
    <form id="profile-form" data-id="${escapeHtml(profile?.id || '')}" data-base-name="${escapeHtml(profile?.name || '')}">
      <label class="field"><span class="field-label">Profile name</span><input id="profile-name" aria-describedby="profile-name-help" name="name" required maxlength="70" value="${escapeHtml(profile?.name || '')}" placeholder="What should we call you?" autocomplete="off" /><span class="field-message" id="profile-name-help" data-field-help>${profile ? 'Make this space your own.' : 'Start a fresh collection of your own.'}</span></label>
      <div class="modal-footer"><button type="button" class="button secondary" data-action="profiles">Back</button><button class="button">${profile ? 'Save changes' : 'Create profile'}</button></div>
    </form>`,
    '',
    false,
    { className: 'profile-form-modal', overlayClassName: 'profiles-overlay' },
  );
  studioState.modal = { kind: 'profile-form', id: profile?.id };
}

export function confirmProfileDeletion(id) {
  const profile = studioState.profiles.find((item) => item.id === id);
  if (!profile) return;
  openDialog(
    'Delete profile?',
    `<p class="playlist-dialog-intro">“${escapeHtml(profile.name)}” and all its songs, playlists, favorites, artwork, reference audio, and generation files will be permanently deleted.</p><p class="playlist-dialog-note">This cannot be undone.</p>`,
    `<button type="button" class="button secondary" data-action="profiles">Keep profile</button><button type="button" class="button danger" data-action="profile-confirm-delete" data-id="${escapeHtml(id)}">Delete profile</button>`,
    false,
    { className: 'profile-confirm-modal', overlayClassName: 'profiles-overlay' },
  );
  studioState.modal = { kind: 'profile-delete', id };
}
