import { studioState, songEdits, findSongById } from '../app/browser-state.js';
import { openDialog } from '../library/library-dialogs.js';
import { escapeHtml } from '../app/text-helpers.js';
import { renderIcon } from '../app/icons.js';
import { getReferenceName } from './reference-label.js';

export function openAutoCompleteDialog(editor) {
  const id = editor.dataset.id || '';
  const song = findSongById(id);
  const edits = id ? songEdits.get(id) || {} : studioState;
  const reference =
    edits.sampleUpload?.name ||
    (edits.removeSample
      ? ''
      : getReferenceName({
          ...song,
          sampleUrl: editor.elements.sampleUrl?.value || '',
          sampleKind: editor.elements.sampleUrl?.value ? 'link' : song?.sampleKind,
          sampleTitle:
            editor.elements.sampleUrl?.value === song?.sampleUrl ? song?.sampleTitle : '',
        }));
  const usesStyle = Boolean(editor.elements.style?.value.trim());
  const sourceDescription = [
    usesStyle ? 'your music style' : '',
    reference ? 'your reference audio' : '',
  ]
    .filter(Boolean)
    .join(' and ');
  openDialog(
    'Auto complete',
    `
    <form id="auto-complete-form" data-id="${escapeHtml(id)}">
      ${reference ? `<p class="lyrics-reference-note">${renderIcon('note', 'sm')}<span dir="auto">${escapeHtml(reference)}</span></p>` : ''}
      <label class="field"><span class="field-label">Your idea</span><textarea id="auto-complete-idea" aria-describedby="auto-complete-idea-help" name="idea" dir="auto" rows="5" placeholder="A feeling, a sound, a line you can’t shake…">${escapeHtml(song?.idea || '')}</textarea><span class="field-message" id="auto-complete-idea-help" data-field-help>Share an idea, or use the details you’ve already entered. We’ll fill in the missing pieces${sourceDescription ? ` using ${sourceDescription}` : ''}.</span></label>
      <div class="modal-footer"><button type="button" class="button secondary" data-action="close-modal">Cancel</button><button class="button">${renderIcon('spark', 'sm')}<span>Auto complete</span></button></div>
    </form>`,
  );
  studioState.modal = { kind: 'auto-complete', id };
}
