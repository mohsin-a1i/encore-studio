import { readDevice } from '../app/device-state.js';
import { studioState, songEdits, findSongById } from '../app/browser-state.js';
import { renderIcon } from '../app/icons.js';
import { escapeHtml } from '../app/text-helpers.js';
import { mediaUrl } from '../app/interface-helpers.js';
import { isSongGenerating } from '../songs/song-status.js';
import { renderSongHeader } from '../songs/song-header.js';
import { renderGenerationScene } from '../generation/generation-scene.js';
import { syncFieldFeedback } from '../app/form-fields.js';

export const getEditedSong = () => findSongById(studioState.selectedSongId);

const createEmptySongDraft = () => ({
  id: '',
  title: studioState.draftTitle,
  style: studioState.draftStyle,
  lyrics: studioState.draftLyrics,
  sampleUrl: studioState.sampleUrl,
  sampleUpload: studioState.sampleUpload,
  removeSample: studioState.removeSample,
  referenceMode: studioState.referenceMode,
  status: 'draft',
});

function needsAutoComplete(song) {
  return (
    ['title', 'style', 'lyrics'].some((field) => !song[field]?.trim()) ||
    !song.genres?.length ||
    song.style !== (song.genreStyle || song.style)
  );
}
function renderEditorSectionHeader(title, tagline) {
  return `<summary><span class="editor-section-title">${title}</span><small>${tagline}</small>${renderIcon('chevron-down', 'sm')}</summary>`;
}

function getEditorSectionAttributes(song, section) {
  const open = studioState.editorSections.get(song.id || 'new')?.[section] ?? true;
  return `data-editor-section="${section}" ${open ? 'open' : ''}`;
}

function getReferenceState(song, edits, value, preparing = false) {
  const hasReference = Boolean(
    value || edits.sampleUpload || (song.sampleKind === 'upload' && !edits.removeSample),
  );
  const changed = Boolean(
    edits.sampleUpload || edits.removeSample || value !== (song.sampleUrl || ''),
  );
  const working = Boolean(preparing || song.referencePreparation?.phase);
  return {
    hasReference,
    changed,
    working,
    phase: song.referencePreparation?.phase || '',
    ready: Boolean(song.referencePrepared && !changed),
    error: changed ? '' : song.referencePreparation?.error || '',
  };
}

function referenceProgressText(phase) {
  if (phase === 'queued') return 'Waiting for other work in ComfyUI to finish…';
  if (phase === 'transcribing') return 'Reading the melody from your reference…';
  if (phase === 'preparing') return 'Waiting for ComfyUI or reading your reference…';
  return 'Loading and reading your reference…';
}

function renderReferenceAudioSection(value = '', song, edits = song) {
  const supported = studioState.health.coverWorkflow !== undefined;
  const reference = getReferenceState(song, edits, value);
  const mode =
    edits.referenceMode || (edits.sampleUpload || song.sampleKind === 'upload' ? 'upload' : 'link');
  const activeReference =
    mode === 'upload'
      ? Boolean(edits.sampleUpload || (song.sampleKind === 'upload' && !edits.removeSample))
      : Boolean(value);
  return /* HTML */ `
    <details
      class="song-editor-section song-sample-section"
      ${getEditorSectionAttributes(song, 'reference')}
    >
      ${renderEditorSectionHeader('Reference Audio', 'A little inspiration, if you like')}
      <div class="editor-section-body">
        <fieldset class="reference-source-switch" aria-label="Reference audio source">
          <label>
            <input
              type="radio"
              name="referenceMode"
              value="link"
              ${mode === 'link' ? 'checked' : ''}
              ${supported && !reference.working ? '' : 'disabled'}
            />
            ${renderIcon('link', 'sm')}
            <span>Video link</span>
          </label>
          <label>
            <input
              type="radio"
              name="referenceMode"
              value="upload"
              ${mode === 'upload' ? 'checked' : ''}
              ${supported && !reference.working ? '' : 'disabled'}
            />
            ${renderIcon('upload', 'sm')}
            <span>Audio file</span>
          </label>
        </fieldset>
        <div class="field reference-field">
          <div class="reference-input-group" role="group" aria-label="Reference audio">
            <div
              class="reference-source-panel reference-link"
              data-reference-panel="link"
              ${mode === 'link' ? '' : 'hidden'}
            >
              <input
                type="url"
                id="sample-url"
                name="sampleUrl"
                value="${escapeHtml(value)}"
                placeholder="Paste a YouTube or Instagram link…"
                aria-label="YouTube or Instagram link"
                ${reference.error ? 'aria-invalid="true"' : ''}
                aria-describedby="${reference.error ? 'sample-error' : 'sample-help'}"
                ${supported && mode === 'link' && !reference.working ? '' : 'disabled'}
              />
            </div>
            <div
              class="reference-source-panel reference-file"
              data-reference-panel="upload"
              ${mode === 'upload' ? '' : 'hidden'}
            >
              <label class="reference-upload">
                ${renderIcon('upload', 'sm')}
                <span>Choose audio</span>
                <input
                  type="file"
                  name="sampleUpload"
                  id="sample-upload"
                  aria-describedby="${reference.error ? 'sample-error' : 'sample-help'}"
                  aria-label="Choose reference audio"
                  ${reference.error ? 'aria-invalid="true"' : ''}
                  accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.webm"
                  ${supported && mode === 'upload' && !reference.working ? '' : 'disabled'}
                />
              </label>
              <span
                class="reference-filename"
                data-reference-filename
                dir="auto"
                role="status"
                title="${escapeHtml(edits.sampleUpload?.name || (song.sampleKind === 'upload' && !edits.removeSample ? song.sampleTitle : '') || 'No audio selected')}"
              >
                ${escapeHtml(edits.sampleUpload?.name || (song.sampleKind === 'upload' && !edits.removeSample ? song.sampleTitle : '') || 'No audio selected')}
              </span>
            </div>
            <button
              type="button"
              class="icon-button reference-prepare"
              data-action="prepare-reference"
              data-reference-prepare
              data-loading="${reference.working}"
              aria-label="${reference.working ? 'Loading reference audio' : 'Load reference audio'}"
              ${activeReference && (!reference.ready || reference.working) ? '' : 'hidden'}
              ${reference.working || reference.ready ? 'disabled' : ''}
              aria-describedby="${reference.error ? 'sample-error' : 'sample-help'}"
            >
              ${renderIcon('download', 'sm')}
              <span data-reference-prepare-label>Load</span>
            </button>
            <button
              type="button"
              class="icon-button reference-remove"
              data-action="clear-reference"
              data-clear-reference
              aria-label="Remove reference audio"
              title="Remove reference audio"
              ${activeReference ? '' : 'hidden'}
              ${reference.working ? 'disabled' : ''}
            >
              ${renderIcon('trash', 'sm')}
            </button>
          </div>
          <p
            class="field-message"
            id="sample-help"
            data-field-help
            ${reference.error ? 'hidden' : ''}
          >
            Add a YouTube or Instagram video, or upload audio up to 25 MB. Auto complete can use
            this reference.
          </p>
          <p
            class="reference-progress"
            data-reference-progress
            role="status"
            ${reference.working ? '' : 'hidden'}
          >
            ${referenceProgressText(reference.phase)}
          </p>
          <p
            class="reference-error field-message field-error"
            id="sample-error"
            data-field-error
            data-reference-error
            role="alert"
            ${reference.error ? '' : 'hidden'}
          >
            ${escapeHtml(reference.error)}
          </p>
        </div>
        ${
          song?.sampleAudio
            ? /* HTML */ `
                <div
                  class="sample-preview"
                  data-sample-preview-container
                  ${value === (song.sampleUrl || '') && !edits.sampleUpload && !edits.removeSample ? '' : 'hidden'}
                >
                  <div>
                    <span class="eyebrow">YOUR SAMPLE</span>
                    <strong dir="auto">
                      ${escapeHtml(song.sampleTitle || 'Reference sample')}
                    </strong>
                  </div>
                  <audio
                    controls
                    preload="none"
                    data-sample-preview
                    aria-label="Listen to the sample audio"
                    src="${mediaUrl(song.sampleAudio)}"
                  ></audio>
                </div>
              `
            : ''
        }
      </div>
    </details>
  `;
}

export function updateEditorControls(form) {
  const song = form.dataset.id ? findSongById(form.dataset.id) : createEmptySongDraft();
  if (!song || isSongGenerating(song)) return;
  const referenceEdits = song.id ? songEdits.get(song.id) || {} : studioState;
  const style = form.elements.style?.value || '';
  const lyrics = form.elements.lyrics?.value || '';
  const canGenerateAudio = Boolean(lyrics.trim());
  const audioAction = form.querySelector('[data-audio-action]');
  if (audioAction) {
    audioAction.hidden = false;
    audioAction.disabled = false;
    audioAction.className = canGenerateAudio ? 'button' : 'button secondary';
  }
  const lyricsError = form.querySelector('[data-lyrics-error]');
  if (canGenerateAudio && lyricsError && !lyricsError.hidden) {
    lyricsError.hidden = true;
    form.elements.lyrics?.removeAttribute?.('aria-invalid');
  }
  syncFieldFeedback(
    form.elements.lyrics,
    form.querySelector('[data-words-description]'),
    lyricsError,
  );
  const lyricsButton = form.querySelector('[data-auto-complete]');
  if (lyricsButton) {
    lyricsButton.hidden = !needsAutoComplete({
      ...song,
      title: form.elements.title?.value ?? song.title,
      style,
      lyrics,
      genreStyle: song.genreStyle || song.style,
    });
    lyricsButton.disabled = false;
    lyricsButton.className = canGenerateAudio ? 'button secondary' : 'button';
  }
  const label = form.querySelector('[data-auto-complete-label]');
  if (label) label.textContent = 'Auto complete';
  for (const [selector, text] of [
    ['[data-style-description]', describeMusicStyle(style)],
    ['[data-words-description]', describeLyrics(lyrics)],
  ]) {
    const target = form.querySelector(selector);
    if (target) target.textContent = text;
  }
  const referenceName = form.querySelector('[data-reference-filename]');
  if (referenceName) {
    referenceName.textContent =
      referenceEdits.sampleUpload?.name ||
      (song.sampleKind === 'upload' &&
      !referenceEdits.removeSample &&
      !form.elements.sampleUrl?.value
        ? song.sampleTitle
        : '') ||
      'No audio selected';
    referenceName.title = referenceName.textContent;
  }
  const clearReference = form.querySelector('[data-clear-reference]');
  const reference = getReferenceState(
    song,
    referenceEdits,
    form.elements.sampleUrl?.value || '',
    form._preparing,
  );
  const mode =
    referenceEdits.referenceMode ||
    (referenceEdits.sampleUpload || song.sampleKind === 'upload' ? 'upload' : 'link');
  const activeReference =
    mode === 'upload'
      ? Boolean(
          referenceEdits.sampleUpload ||
          (song.sampleKind === 'upload' && !referenceEdits.removeSample),
        )
      : Boolean(form.elements.sampleUrl?.value);
  if (clearReference) clearReference.hidden = !activeReference;
  if (clearReference) clearReference.disabled = reference.working;
  const prepare = form.querySelector('[data-reference-prepare]');
  if (prepare) {
    prepare.hidden = !activeReference || (reference.ready && !reference.working);
    prepare.disabled = reference.working || reference.ready;
    prepare.dataset.loading = String(reference.working);
    prepare.setAttribute(
      'aria-label',
      reference.working ? 'Loading reference audio' : 'Load reference audio',
    );
    const label = prepare.querySelector('[data-reference-prepare-label]');
    if (label) label.textContent = 'Load';
  }
  const progress = form.querySelector('[data-reference-progress]');
  if (progress) {
    progress.hidden = !reference.working;
    progress.textContent = referenceProgressText(reference.phase);
  }
  const error = form.querySelector('[data-reference-error]');
  if (error) {
    error.textContent = reference.error || form._referenceError || '';
    error.hidden = !error.textContent;
  }
  syncFieldFeedback(
    mode === 'upload' ? form.elements.sampleUpload : form.elements.sampleUrl,
    form.querySelector('#sample-help'),
    error,
  );
  if (audioAction) audioAction.disabled = reference.working;
  if (lyricsButton) lyricsButton.disabled = reference.working;
  for (const panel of form.querySelectorAll?.('[data-reference-panel]') || [])
    panel.hidden = panel.dataset.referencePanel !== mode;
  if (form.elements.sampleUrl)
    form.elements.sampleUrl.disabled =
      mode !== 'link' || studioState.health.coverWorkflow === undefined || reference.working;
  if (form.elements.sampleUpload)
    form.elements.sampleUpload.disabled =
      mode !== 'upload' || studioState.health.coverWorkflow === undefined || reference.working;
  for (const switchInput of form.querySelectorAll?.('input[name="referenceMode"]') || [])
    switchInput.disabled = reference.working || studioState.health.coverWorkflow === undefined;
  const preview = form.querySelector('[data-sample-preview-container]');
  if (preview && form.elements.sampleUrl) {
    preview.hidden =
      form.elements.sampleUrl.value !== (song.sampleUrl || '') ||
      Boolean(referenceEdits.sampleUpload || referenceEdits.removeSample);
    if (preview.hidden) preview.querySelector('audio')?.pause();
  }
}

export function getEditorSnapshotKey() {
  const song = getEditedSong();
  return song
    ? `${song.id}:${song.status}:${song.updatedAt}:${song.audioVersion || ''}:${song.cover || ''}`
    : 'new';
}

function describeMusicStyle(value) {
  return value?.trim()
    ? 'Shape the genre, instruments, and atmosphere for your next take.'
    : 'Describe the sound you imagine, or let Auto complete fill in a musical style.';
}

function describeLyrics(value) {
  return value?.trim()
    ? 'Make every line your own, then compose again to hear your changes.'
    : 'Write the words you want to hear, or use Auto complete to turn your idea into lyrics.';
}

function renderTextSection(song, edits, key, title, tagline, description, rows, placeholder) {
  return `<details class="song-editor-section song-${key}-section" ${getEditorSectionAttributes(song, key)}>
    ${renderEditorSectionHeader(title, tagline)}
    <div class="editor-section-body"><div class="field">
      <label class="field-label" for="song-${key}">${title}</label>
      <textarea dir="auto" id="song-${key}" name="${key}" aria-label="${title}" aria-describedby="song-${key}-help" rows="${rows}" placeholder="${placeholder}">${escapeHtml(edits[key])}</textarea>
      <p class="field-message" id="song-${key}-help" data-field-help data-${key === 'style' ? 'style' : 'words'}-description>${description}</p>
      ${key === 'lyrics' ? '<p class="lyrics-validation-error field-message field-error" id="song-lyrics-error" data-field-error data-lyrics-error role="alert" hidden>Add lyrics to generate a song.</p>' : ''}
    </div></div>
  </details>`;
}

export function renderSongEditor() {
  const song = getEditedSong() || createEmptySongDraft();
  const creating = !song.id;
  const active = isSongGenerating(song);
  const edits = { ...song, ...songEdits.get(song.id) };
  const canGenerateAudio = Boolean(edits.lyrics?.trim());
  const referenceWorking = Boolean(song.referencePreparation?.phase);
  return /* HTML */ `
    <form
      class="compose-card song-editor"
      id="song-editor-form"
      data-id="${escapeHtml(song.id)}"
      data-edit-revision="${song.editRevision || 0}"
      ${creating ? 'data-new-song' : ''}
      aria-busy="${active}"
    >
      <div class="song-editor-topbar">
        <div class="song-editor-context">
          <span class="eyebrow">${creating ? 'A NEW BEGINNING' : 'ON YOUR DECK'}</span>
        </div>
        <div class="song-editor-tools">
          <span class="eyebrow" data-editor-save-status role="status"></span>
          ${studioState.deletedEditorId ? '<button type="button" class="text-button" data-action="recover-deleted-editor">Recover edits as new song</button>' : ''}
          ${!active && readDevice(`recovery:${song.id || 'new'}`, null, studioState.profileId) ? '<button type="button" class="text-button" data-action="recover-editor">Recover edits</button>' : ''}
          ${creating || active ? '' : `<button type="button" class="icon-button song-delete-action" data-action="delete-song" data-id="${escapeHtml(song.id)}" aria-label="Delete song" title="Delete song">${renderIcon('trash', 'sm')}</button>`}
        </div>
      </div>
      ${
        active
          ? ''
          : `<div class="offline-note" role="alert" data-editor-conflict ${studioState.editorConflictId === song.id ? '' : 'hidden'}>
        <button type="button" class="text-button" data-action="reload-editor">Reload saved</button>
        <button type="button" class="text-button" data-action="reapply-editor">Use my edits</button>
      </div>`
      }
      ${renderSongHeader(song, { editor: true, creating, active, edits })}
      ${song.error ? `<section class="studio-error" role="status"><strong>This take couldn’t be completed.</strong><details><summary>See what happened</summary><p dir="auto">${escapeHtml(song.error)}</p></details></section>` : ''}
      ${
        active
          ? renderGenerationScene(song)
          : `
        <fieldset class="song-writing-fields">
          ${renderReferenceAudioSection(edits.sampleUrl || '', song, edits)}
          ${renderTextSection(song, edits, 'style', 'Music Style', 'Give your words a sound', describeMusicStyle(edits.style), 4, 'Genre, instruments, atmosphere…')}
          ${renderTextSection(song, edits, 'lyrics', 'Lyrics', 'The lines that make it yours', describeLyrics(edits.lyrics), 16, '[Verse]\nYour words start here…')}
        </fieldset>`
      }
      <footer class="song-editor-footer">
        <div class="song-primary-actions">
          ${
            active
              ? `<button type="button" class="button secondary" data-action="cancel-song" data-id="${escapeHtml(song.id)}">${song.status === 'lyrics' ? 'Stop Completing' : 'Stop Composing'}</button>`
              : `
          <button type="button" class="button${canGenerateAudio ? ' secondary' : ''}" data-auto-complete data-action="auto-complete" ${needsAutoComplete({ ...edits, genreStyle: song.genreStyle || song.style }) ? '' : 'hidden'} ${referenceWorking ? 'disabled' : ''}>${renderIcon('spark', 'sm')}<span data-auto-complete-label>Auto complete</span></button>
          <button type="submit" class="button${canGenerateAudio ? '' : ' secondary'}" name="intent" value="audio" data-audio-action ${referenceWorking ? 'disabled' : ''}>${renderIcon('note', 'sm')}<span>${song.audio ? 'Regenerate Song' : 'Generate Song'}</span></button>`
          }
        </div>
      </footer>
    </form>
  `;
}
