import { studioState } from '../app/browser-state.js';
import { escapeHtml } from '../app/text-helpers.js';
import { renderIcon } from '../app/icons.js';
import { openDialog } from '../library/library-dialogs.js';

export function openExploreIdeaDialog() {
  studioState.modal = { kind: 'explore-idea' };
  openDialog(
    'Follow a feeling',
    /* HTML */ `
      <form id="explore-form" class="explore-form">
        <div class="field">
          <label class="field-label" for="explore-idea">Your idea</label>
          <textarea
            id="explore-idea"
            name="idea"
            aria-describedby="explore-idea-help"
            rows="4"
            maxlength="4000"
            required
            placeholder="Warm indie pop for a late-night drive…"
          >
${escapeHtml(studioState.exploreDraft ?? studioState.explore.idea ?? '')}</textarea>
          <p class="field-message" id="explore-idea-help" data-field-help>
            A mood, a memory, a world you want to step into. Where should the music take you?
          </p>
        </div>
        <div class="explore-idea-actions">
          <button class="button secondary" type="button" data-action="close-modal">Cancel</button>
          <button class="button" type="submit">
            ${renderIcon('spark', 'sm')}
            <span>Explore this idea</span>
          </button>
        </div>
      </form>
    `,
    '',
    false,
    { className: 'explore-idea-dialog' },
  );
}
