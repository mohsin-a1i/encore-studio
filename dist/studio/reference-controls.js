import { studioState, songEdits, findSongById } from '../app/browser-state.js';
import { updateEditorControls } from './editor-view.js';
import { syncFieldFeedback, showFieldError } from '../app/form-fields.js';

export function clearReferenceSelection(form) {
  form._referenceError = '';
  const edits = form.dataset.id ? songEdits.get(form.dataset.id) || {} : studioState;
  Object.assign(edits, {
    sampleUrl: '',
    sampleUpload: null,
    removeSample: true,
  });
  if (form.dataset.id) songEdits.set(form.dataset.id, edits);
  form.elements.sampleUrl.value = '';
  form.elements.sampleUpload.value = '';
  updateEditorControls(form);
}

export function allowGenerationWithReference(form) {
  const song = findSongById(form.dataset.id);
  const edits = form.dataset.id ? songEdits.get(form.dataset.id) || {} : studioState;
  const url = form.elements.sampleUrl?.value.trim() || '';
  const hasReference = Boolean(
    url || edits.sampleUpload || (song?.sampleKind === 'upload' && !edits.removeSample),
  );
  const loaded = Boolean(
    song?.referencePrepared &&
    !edits.sampleUpload &&
    !edits.removeSample &&
    url === (song.sampleUrl || ''),
  );
  if (!hasReference || loaded) return true;
  const section = form.querySelector('[data-editor-section="reference"]');
  if (section) {
    section.open = true;
    section.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }
  const error = form.querySelector('[data-reference-error]');
  if (error) {
    error.textContent = url
      ? 'Load or delete the reference URL before continuing.'
      : 'Load or remove the reference audio before continuing.';
    error.hidden = false;
  }
  syncFieldFeedback(
    url ? form.elements.sampleUrl : form.elements.sampleUpload,
    form.querySelector('#sample-help'),
    error,
  );
  form.querySelector('[data-reference-prepare]')?.focus?.({ preventScroll: true });
  return false;
}

export function handleReferenceSourceChange(event, onAudioSelected = () => {}) {
  if (event.target.name === 'referenceMode') {
    const form = event.target.closest('#song-editor-form');
    if (!form) return;
    form._referenceError = '';
    const edits = form.dataset.id ? songEdits.get(form.dataset.id) || {} : studioState;
    edits.referenceMode = event.target.value;
    if (form.dataset.id) songEdits.set(form.dataset.id, edits);
    updateEditorControls(form);
  }
  if (event.target.name === 'sampleUpload') {
    const form = event.target.closest('#song-editor-form');
    const file = event.target.files?.[0];
    if (!form || !file) return;
    form._referenceError = '';
    if (file.size > 25_000_000) {
      event.target.value = '';
      showFieldError(event.target, 'Choose an audio file smaller than 25 MB.');
      return;
    }
    const edits = form.dataset.id ? songEdits.get(form.dataset.id) || {} : studioState;
    Object.assign(edits, {
      sampleUpload: file,
      sampleUrl: '',
      removeSample: false,
    });
    if (form.dataset.id) songEdits.set(form.dataset.id, edits);
    form.elements.sampleUrl.value = '';
    updateEditorControls(form);
    onAudioSelected(form);
  }
  return ['referenceMode', 'sampleUpload'].includes(event.target.name);
}

export function recordEditorInput(input) {
  const editor = input.closest('#song-editor-form');
  if (editor && ['sampleUpload', 'referenceMode'].includes(input.name)) return;
  if (editor && input.name) {
    if (editor.hasAttribute('data-new-song')) {
      if (input.name === 'title') studioState.draftTitle = input.value;
      if (input.name === 'style') studioState.draftStyle = input.value;
      if (input.name === 'lyrics') studioState.draftLyrics = input.value;
      if (input.name === 'sampleUrl') studioState.sampleUrl = input.value;
    } else {
      songEdits.set(editor.dataset.id, {
        _baseRevision: Number(
          editor.dataset.editRevision ?? findSongById(editor.dataset.id)?.editRevision ?? 0,
        ),
        ...(songEdits.get(editor.dataset.id) || {}),
        [input.name]: input.value,
      });
    }
    if (input.name === 'sampleUrl') {
      editor._referenceError = '';
      const edits = editor.dataset.id ? songEdits.get(editor.dataset.id) : studioState;
      edits.sampleUpload = null;
      edits.removeSample = !input.value;
      editor.elements.sampleUpload.value = '';
    }
    updateEditorControls(editor);
  }
}
