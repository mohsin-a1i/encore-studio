import { writeDevice } from '../app/device-state.js';
import { studioState, songEdits, findSongById } from '../app/browser-state.js';
import { createRequestId } from '../app/request-id.js';
import { showToast } from '../app/interface-helpers.js';
import { closeDialog } from '../library/library-dialogs.js';
import { updateEditorControls } from './editor-view.js';
import { encodeReferenceInput } from './reference-input.js';
import { allowGenerationWithReference } from './reference-controls.js';
import { syncFieldFeedback } from '../app/form-fields.js';

async function readReferenceInput(form) {
  const edits = form.dataset.id ? songEdits.get(form.dataset.id) || {} : studioState;
  return encodeReferenceInput(form.elements.sampleUrl?.value || '', edits);
}

export function createEditorActions({
  requestStudio,
  refreshLibrary,
  renderApplication,
  flushEditorSave = async () => {},
}) {
  async function startEditorGeneration(form, intent, idea = '') {
    if (form._generating) return;
    if (intent === 'audio' && !form.elements.lyrics?.value.trim()) {
      const lyrics = form.elements.lyrics;
      const section = form.querySelector('[data-editor-section="lyrics"]');
      const error = form.querySelector('[data-lyrics-error]');
      if (section) section.open = true;
      if (error) error.hidden = false;
      syncFieldFeedback(lyrics, form.querySelector('[data-words-description]'), error);
      lyrics?.setAttribute?.('aria-invalid', 'true');
      (error || lyrics)?.scrollIntoView?.({
        block: 'center',
        behavior: 'auto',
      });
      lyrics?.focus?.({ preventScroll: true });
      return;
    }
    if (!allowGenerationWithReference(form)) return;
    form._generating = true;
    const profileId = studioState.profileId;
    let id = form.dataset.id;
    const buttons = [...form.querySelectorAll('button')];
    buttons.forEach((button) => {
      button.disabled = true;
    });
    form.setAttribute('aria-busy', 'true');
    if (!id) studioState.pending = true;
    try {
      await flushEditorSave(form);
      id = form.dataset.id;
      const reference = await readReferenceInput(form);
      if (profileId !== studioState.profileId) return;
      const fields = ['title', 'style', 'lyrics'];
      const input = {
        ...Object.fromEntries(fields.map((key) => [key, form.elements[key]?.value || ''])),
        ...reference,
      };
      if (id)
        input.baseRevision = Number(
          form.dataset.editRevision ?? findSongById(id)?.editRevision ?? 0,
        );
      if (intent === 'lyrics') input.idea = idea;
      if (!id) input.kind = intent;
      const song = await requestStudio(id ? `songs/${id}/${intent}` : 'songs', {
        method: 'POST',
        headers: { 'X-Request-Id': createRequestId() },
        body: JSON.stringify(input),
      });
      if (profileId !== studioState.profileId) return;
      if (intent === 'lyrics') {
        if (id)
          songEdits.set(id, {
            ...songEdits.get(id),
            _lyricsJobId: song.job.id,
          });
        if (studioState.modal?.kind === 'auto-complete' && studioState.modal.id === (id || ''))
          closeDialog();
      }
      if (!id) {
        studioState.draftTitle = '';
        studioState.draftStyle = '';
        studioState.draftLyrics = '';
        studioState.sampleUrl = '';
        studioState.sampleUpload = null;
        studioState.removeSample = false;
      }
      studioState.selectedSongId = song.id;
      studioState.composingSong = false;
      writeDevice('song-id', song.id, studioState.profileId);
      await refreshLibrary();
      renderApplication();
      showToast(
        intent === 'lyrics' ? 'Filling in the missing pieces.' : 'Your sound is on its way.',
      );
    } finally {
      form._generating = false;
      if (profileId === studioState.profileId) studioState.pending = false;
      buttons.forEach((button) => {
        button.disabled = false;
      });
      form.setAttribute('aria-busy', 'false');
      updateEditorControls(form);
    }
  }

  async function startAutoCompletion(dialogForm) {
    const editor = document.querySelector('#song-editor-form');
    if (!editor || (editor.dataset.id || '') !== dialogForm.dataset.id)
      throw new Error('Open Auto complete from the song you want to edit.');
    if (dialogForm._generating) return;
    dialogForm._generating = true;
    const buttons = [...dialogForm.querySelectorAll('button')];
    buttons.forEach((button) => {
      button.disabled = true;
    });
    try {
      await startEditorGeneration(editor, 'lyrics', dialogForm.elements.idea.value);
    } finally {
      dialogForm._generating = false;
      buttons.forEach((button) => {
        button.disabled = false;
      });
    }
  }
  return { startEditorGeneration, startAutoCompletion };
}
