const pairs = [
  ['.studio-song-card', ':scope > img', '.studio-song-info'],
  ['.studio-create-song', ':scope > .icon', ':scope > .heading-stack'],
  ['.playlist-card', ':scope > img', '.playlist-card-copy'],
  ['.song-cell', ':scope > img', ':scope > div'],
  ['.song-playlist-link', ':scope > img', ':scope > span'],
  ['.selection-item', ':scope > img', ':scope > .selection-name'],
  ['.selection-create', ':scope > .icon', ':scope > .selection-name'],
  ['.song-identity:not([data-no-cover])', '.song-cover-control', '.song-identity-copy'],
  ['.playlist-hero', ':scope > [data-action="upload-cover"]', '.playlist-identity-copy'],
  ['.settings-service-header', '.settings-service-icon', '.heading-stack'],
  ['.theme-option-magic .theme-choice', '.theme-preview', '.theme-choice-copy'],
  ['.now-playing', ':scope > img', ':scope > div'],
  ['.create-nav', '.studio-nav-art', '.studio-nav-copy'],
  ['.brand', ':scope > .icon', ':scope > span'],
  ['.mobile-brand', ':scope > .icon', ':scope > span'],
  ['.profile-choice', ':scope > .avatar', '.profile-switch-copy'],
  [
    '.nav button:not(.create-nav)',
    ':scope > .icon, :scope > .connection-icon',
    ':scope > span:not(.connection-icon)',
  ],
  ['.button', ':scope > .icon', ':scope > span:not(.visually-hidden)'],
];

function contentHeight(element, bounds) {
  const style = getComputedStyle(element);
  return (
    bounds.height -
    parseFloat(style.paddingTop) -
    parseFloat(style.paddingBottom) -
    parseFloat(style.borderTopWidth) -
    parseFloat(style.borderBottomWidth)
  );
}

export function initializeMediaPairs(...roots) {
  if (!globalThis.ResizeObserver || !globalThis.MutationObserver) return;
  const tracked = new Map();
  let frame;
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const observer = new ResizeObserver(schedule);

  function update() {
    frame = null;
    for (const [pair, entry] of tracked) {
      if (!pair.isConnected || !pair.contains(entry.copy) || !pair.contains(entry.graphic)) {
        observer.unobserve(entry.copy);
        tracked.delete(pair);
      }
    }
    for (const root of roots) {
      for (const [selector, graphicSelector, copySelector] of pairs) {
        for (const pair of root.querySelectorAll(selector)) {
          if (tracked.has(pair)) continue;
          const graphic = pair.querySelector(graphicSelector);
          const copy = pair.querySelector(copySelector);
          if (!graphic || !copy) continue;
          tracked.set(pair, { graphic, copy });
          observer.observe(copy);
        }
      }
    }
    for (const [pair, { graphic, copy }] of tracked) {
      const text = copy.getBoundingClientRect();
      const art = graphic.getBoundingClientRect();
      if (!text.height || !text.width || pair.hasAttribute('data-media-stacked')) continue;
      // A vertical card keeps its existing artwork presentation.
      if (text.left < art.right - 1 || getComputedStyle(pair).flexDirection === 'column') continue;
      const size = Math.round(contentHeight(copy, text) * 100) / 100;
      if (size <= 0) continue;
      const style = getComputedStyle(pair);
      const available =
        pair.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const magic = pair.matches('.theme-option-magic .theme-choice');
      const gap = parseFloat(style.columnGap) || 0;
      if (
        pair.matches('.song-identity, .playlist-hero, .theme-option-magic .theme-choice') &&
        size + (magic ? 180 : 220) + gap > available
      ) {
        pair.setAttribute('data-media-stacked', '');
        graphic.style.removeProperty('width');
        graphic.style.removeProperty('height');
        pair.style.removeProperty('grid-template-columns');
        continue;
      }
      pair.setAttribute('data-media-pair', '');
      graphic.setAttribute('data-media-graphic', '');
      copy.setAttribute('data-media-copy', '');
      const value = `${size}px`;
      if (graphic.style.width !== value) graphic.style.width = value;
      if (graphic.style.height !== value) graphic.style.height = value;
      if (pair.style.getPropertyValue('--media-size') !== value)
        pair.style.setProperty('--media-size', value);
      if (style.display === 'grid' || style.display === 'inline-grid')
        pair.style.gridTemplateColumns = `${value} minmax(0, 1fr)`;
    }
  }

  for (const root of roots) {
    new MutationObserver((mutations) => {
      if (
        mutations.some((mutation) =>
          [...mutation.addedNodes, ...mutation.removedNodes].some((node) => node.nodeType === 1),
        )
      )
        schedule();
    }).observe(root, { childList: true, subtree: true });
  }
  window.addEventListener('resize', () => {
    for (const [pair, { graphic, copy }] of tracked) {
      pair.removeAttribute('data-media-stacked');
      pair.removeAttribute('data-media-pair');
      pair.style.removeProperty('grid-template-columns');
      pair.style.removeProperty('--media-size');
      graphic.style.removeProperty('width');
      graphic.style.removeProperty('height');
      graphic.removeAttribute('data-media-graphic');
      copy.removeAttribute('data-media-copy');
    }
    schedule();
  });
  schedule();
}
