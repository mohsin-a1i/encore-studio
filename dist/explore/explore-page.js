import { renderEmptyState } from '../app/empty-state.js';
import { studioState } from '../app/browser-state.js';
import { escapeHtml } from '../app/text-helpers.js';
import { mediaUrl } from '../app/interface-helpers.js';
import { renderIcon } from '../app/icons.js';
import { renderSongHeading } from '../songs/song-heading.js';
import {
  getExploreCandidates,
  getReadyExploreSongs,
  getExploreSong,
  exploreDeckSize,
} from './explore-session.js';
import { renderGenerationArt } from '../generation/generation-scene.js';
import { captureDeck, animateDeck } from './deck-motion.js';

const renderedResults = new WeakMap();

export function renderExplorePage(connectionNotice = '') {
  const html = renderExploreResults();
  return /* HTML */ `
    <div class="page-intro">
      <div>
        <div class="eyebrow">FOLLOW A FEELING</div>
        <h1>Explore</h1>
        <p>Give your next song a spark. Keep the sounds that stay with you.</p>
      </div>
    </div>
    ${connectionNotice}
    <button
      type="button"
      class="button explore-idea-fab"
      data-action="explore-idea"
      aria-label="Set your idea"
      aria-haspopup="dialog"
      title="Set your Explore idea"
    >
      ${renderIcon('spark')}
      <span>Set your idea</span>
    </button>
    <div id="explore-results">${html}</div>
  `;
}

function renderPreparingCopy() {
  const active = getExploreCandidates(studioState).find(
    (song) => song.job?.phase && song.job.phase !== 'queued' && !song.error && !song.audio,
  );
  const text =
    active?.job.kind === 'audio'
      ? 'Composing the music for your idea.'
      : active?.job.phase === 'writing'
        ? 'Finding the words for your idea.'
        : 'Your next sound is queued and taking shape.';
  return `<div class="explore-preparing-copy heading-stack"><strong>A little magic, taking shape.</strong><p data-explore-phase>${text}</p></div>`;
}

function renderSongCard(song, index) {
  const front = index === 0;
  const playing = studioState.currentId === song.id && studioState.playing;
  return `<article class="explore-card${front ? '' : ' explore-back-card'}" data-slot="${index}" data-deck-key="${escapeHtml(song.id)}" ${front ? `data-explore-card data-id="${escapeHtml(song.id)}" tabindex="0" aria-label="${escapeHtml(song.title || 'Untitled song')}. Swipe left to skip or right to save. Arrow keys also work."` : 'aria-hidden="true" inert'}>
    <span class="explore-swipe-hint" data-swipe-hint aria-hidden="true"></span>
    <img src="${mediaUrl(song.cover)}" alt="" draggable="false" />
    <div class="explore-card-copy heading-stack"><span class="eyebrow">TEMPORARY DISCOVERY</span>${renderSongHeading(song)}<p dir="auto">${escapeHtml(song.style || '')}</p></div>
    <button class="button secondary" data-song-play aria-pressed="${Boolean(playing)}" data-action="play" data-id="${escapeHtml(song.id)}">${renderIcon(playing ? 'pause' : 'play', 'sm')}<span>${playing ? 'Pause' : 'Play song'}</span></button>
  </article>`;
}
function renderExploreResults() {
  const starting =
    studioState.exploreStarting?.profileId === studioState.profileId
      ? studioState.exploreStarting
      : null;
  const explore = starting
    ? { ...studioState.explore, idea: starting.idea, pending: 1, error: '' }
    : studioState.explore;
  const ready = getReadyExploreSongs(studioState);
  const song = getExploreSong(studioState);
  const cards = song
    ? [song, ...ready.filter((item) => item.id !== song.id)].slice(0, exploreDeckSize)
    : [];
  const generating =
    getExploreCandidates(studioState).some((item) => !item.audio && !item.error) ||
    explore.pending > 0;
  const slots = cards.map(renderSongCard);
  if (generating && slots.length < exploreDeckSize)
    slots.push(
      `<article class="explore-card explore-preparing-card${slots.length ? '' : ' explore-preparing-empty'}" data-slot="${slots.length}" data-deck-key="preparing" role="status" aria-label="Preparing another song">${renderGenerationArt()}${renderPreparingCopy()}</article>`,
    );
  if (!slots.length)
    return explore.error
      ? ''
      : renderEmptyState({
          heading: 'h2',
          title: explore.idea ? 'Ready for a new discovery?' : 'An idea. Endless possibilities.',
          description: explore.idea
            ? 'Set an idea to discover your next sound.'
            : 'Set a mood, tell a story, or follow a feeling.',
          icon: 'spark',
          action: {
            action: 'explore-idea',
            label: explore.idea ? 'Set a new idea' : 'Set your idea',
          },
        });
  const action = (direction, label, icon) =>
    song
      ? `<button class="explore-side-action" data-action="explore-${direction}" aria-label="${label}" ${explore.busy ? 'disabled' : ''}>${renderIcon(icon)}</button>`
      : '<span class="explore-side-spacer" aria-hidden="true"></span>';
  return `<div class="explore-deck-layout">${action('skip', 'Skip song', 'close')}<div class="explore-deck">${slots.reverse().join('')}</div>${action('save', 'Save song to library', 'heart')}</div>${song ? '<p class="explore-footnote">Swipe left to skip · Swipe right to save</p>' : ''}`;
}

export function refreshExplorePage() {
  const current = document.querySelector('#explore-results');
  if (!current) return;
  const html = renderExploreResults();
  if (!renderedResults.has(current)) {
    renderedResults.set(current, html);
    return;
  }
  if (renderedResults.get(current) !== html && !current.querySelector('[data-dragging]')) {
    const focused = current.contains(document.activeElement) ? document.activeElement : null;
    const previousDeck = captureDeck(current);
    current.innerHTML = html;
    renderedResults.set(current, html);
    animateDeck(current, previousDeck);
    if (focused)
      current
        .querySelector(
          focused.dataset.action
            ? `[data-action="${focused.dataset.action}"]`
            : '[data-explore-card]',
        )
        ?.focus({ preventScroll: true });
  }
}
