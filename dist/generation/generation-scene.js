import { renderIcon } from '../app/icons.js';
import { escapeHtml } from '../app/text-helpers.js';
import { getGenerationCopy } from './generation-copy.js';
import { getReferenceName } from '../studio/reference-label.js';

function inputCard(label, value, symbol) {
  if (!value) return '';
  return `<div class="generation-input"><dt>${renderIcon(symbol, 'sm')}<span>${label}</span></dt><dd><pre tabindex="0" dir="auto" aria-label="${label} used for generation">${escapeHtml(value)}</pre></dd></div>`;
}

export function renderGenerationArt({ writing = false } = {}) {
  const signal = writing
    ? '<div class="generation-ink"><i></i><i></i><i></i></div>'
    : `<div class="generation-wave">${[12, 22, 32, 18, 36, 26, 40, 28, 20, 32, 22, 12].map((height, index) => `<i style="--bar-height:${height}px;--bar-delay:${index * -0.13}s"></i>`).join('')}</div>`;
  return /* HTML */ `
    <div class="generation-art" aria-hidden="true">
      <div class="generation-orbit"></div>
      <div class="generation-emblem">
        <span class="generation-core">${renderIcon(writing ? 'edit' : 'note')}</span>
        <div class="generation-signal">${signal}</div>
      </div>
    </div>
  `;
}

export function renderGenerationScene(song) {
  const writing = song.job?.kind === 'lyrics' || song.status === 'lyrics';
  const input = song.job?.input || song;
  const copy = getGenerationCopy(song);
  const materials = [
    writing ? inputCard('Idea', song.idea, 'spark') : '',
    inputCard('Reference audio', getReferenceName(song), 'note'),
    inputCard('Musical style', input.style, 'note'),
    writing ? '' : inputCard('Lyrics', input.lyrics, 'lyrics'),
  ].join('');
  return /* HTML */ `
    <section
      class="generation-scene"
      data-kind="${writing ? 'lyrics' : 'audio'}"
      aria-labelledby="generation-scene-heading"
    >
      <div class="generation-stage">
        ${renderGenerationArt({ writing })}
        <div class="generation-copy heading-stack">
          <h2 id="generation-scene-heading">${copy.title}</h2>
          <p>${copy.description}</p>
        </div>
      </div>
      ${
        materials
          ? `<section class="generation-inputs" aria-labelledby="generation-inputs-heading">
        <header class="generation-inputs-heading heading-stack">
          <h3 id="generation-inputs-heading">Source material</h3>
          <p>
            ${writing ? 'The inspiration shaping your title, style and lyrics.' : 'The saved ingredients going into your song.'}
          </p>
        </header>
        <dl>
          ${materials}
        </dl>
      </section>`
          : ''
      }
    </section>
  `;
}
