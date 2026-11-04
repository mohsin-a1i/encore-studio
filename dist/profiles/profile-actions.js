import { studioState } from '../app/browser-state.js';
import { closeDialog } from '../library/library-dialogs.js';
import { showToast } from '../app/interface-helpers.js';
import { openProfiles, openProfileForm, confirmProfileDeletion } from './profile-dialogs.js';
import { selectProfileWorkspace } from './profile-state.js';

export function createProfileActions({
  requestStudio,
  refreshLibrary,
  renderApplication,
  beforeSwitch = async () => {},
}) {
  let busy = false;
  async function switchProfile(id) {
    try {
      await beforeSwitch();
    } catch {
      showToast('Unsaved edits are kept on this device.');
    }
    closeDialog();
    selectProfileWorkspace(id);
    const url = new URL(location.href);
    url.searchParams.delete('profile');
    url.hash = 'home';
    window.history?.replaceState(null, '', url);
    renderApplication();
    await refreshLibrary();
    renderApplication();
  }
  async function handleProfileAction(action, id) {
    if (busy) return;
    if (action === 'profiles') {
      const data = await requestStudio('profiles');
      studioState.profiles = data.profiles;
      openProfiles();
    } else if (action === 'profile-create') openProfileForm();
    else if (action === 'profile-rename') openProfileForm(id);
    else if (action === 'profile-delete') confirmProfileDeletion(id);
    else if (action === 'profile-switch') {
      if (id === studioState.profileId) return closeDialog();
      busy = true;
      try {
        await switchProfile(id);
      } finally {
        busy = false;
      }
    } else if (action === 'profile-confirm-delete') {
      busy = true;
      try {
        if (id === studioState.profileId) selectProfileWorkspace(id);
        const result = await requestStudio('profiles/' + id, {
          method: 'DELETE',
          body: JSON.stringify({ confirmation: id }),
        });
        studioState.profiles = result.profiles;
        if (id === studioState.profileId) await switchProfile(result.profiles[0].id);
        else {
          await refreshLibrary();
          renderApplication();
        }
        openProfiles();
        showToast('Profile deleted.');
      } finally {
        busy = false;
      }
    }
  }
  async function saveProfile(form) {
    if (busy) return;
    busy = true;
    const button = form.querySelector('button:not([type=button])');
    if (button) button.disabled = true;
    try {
      const id = form.dataset.id;
      const profile = await requestStudio('profiles' + (id ? '/' + id : ''), {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...Object.fromEntries(new FormData(form)),
          ...(id ? { baseName: form.dataset.baseName } : {}),
        }),
      });
      if (!id) {
        studioState.profiles.push(profile);
        await switchProfile(profile.id);
      } else {
        await refreshLibrary();
        renderApplication();
        openProfiles();
      }
      showToast(id ? 'Profile renamed.' : 'Your new profile is ready.');
    } finally {
      busy = false;
      if (button) button.disabled = false;
    }
  }
  return { handleProfileAction, saveProfile };
}
