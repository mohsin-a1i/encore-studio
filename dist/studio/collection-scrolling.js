let viewport;
let resizeObserver;
let savedScrollTop = 0;
let selectedId;

function updateSongScrollControls() {
  if (!viewport) return;
  const collection = viewport.closest('.studio-collection');
  const overflow = viewport.scrollHeight > viewport.clientHeight + 2;
  const before = overflow && viewport.scrollTop > 2;
  const after = overflow && viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 2;
  collection.dataset.scrollBefore = before;
  collection.dataset.scrollAfter = after;
  viewport.tabIndex = overflow ? 0 : -1;
  savedScrollTop = viewport.scrollTop;
}

export function initializeSongScrolling() {
  const next = document.querySelector('#studio-song-scroll');
  if (next !== viewport) {
    viewport?.removeEventListener('scroll', updateSongScrollControls);
    resizeObserver?.disconnect();
    viewport = next;
    if (!viewport) return;
    viewport.scrollTop = savedScrollTop;
    viewport.addEventListener('scroll', updateSongScrollControls, { passive: true });
    resizeObserver = new ResizeObserver(updateSongScrollControls);
    resizeObserver.observe(viewport);
    resizeObserver.observe(viewport.firstElementChild);
  }
  if (!viewport) return;

  const selected = viewport.querySelector('.studio-song-card.selected');
  if (selected && selected.dataset.id !== selectedId) {
    const bounds = viewport.getBoundingClientRect();
    const card = selected.getBoundingClientRect();
    if (card.top < bounds.top) viewport.scrollTop += card.top - bounds.top - 4;
    else if (card.bottom > bounds.bottom) viewport.scrollTop += card.bottom - bounds.bottom + 4;
  }
  selectedId = selected?.dataset.id;
  updateSongScrollControls();
}
