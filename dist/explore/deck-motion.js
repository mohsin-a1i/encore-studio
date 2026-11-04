export function captureDeck(root) {
  const cards = new Map();
  if (!globalThis.getComputedStyle || !globalThis.DOMMatrixReadOnly) return cards;
  for (const element of root.querySelectorAll?.('[data-deck-key]') || []) {
    const rect = element.getBoundingClientRect();
    const transform = getComputedStyle(element).transform;
    const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform);
    cards.set(element.dataset.deckKey, {
      x: rect.left + rect.width / 2 - matrix.e,
      y: rect.top + rect.height / 2 - matrix.f,
      width: element.offsetWidth,
      height: element.offsetHeight,
      transform,
    });
  }
  return cards;
}

export function animateDeck(root, previous) {
  if (!previous.size || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const current = captureDeck(root);
  for (const element of root.querySelectorAll?.('[data-deck-key]') || []) {
    const before = previous.get(element.dataset.deckKey);
    const after = current.get(element.dataset.deckKey);
    if (!after || !after.width || !after.height || !element.animate) continue;
    if (!before) {
      element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
      continue;
    }
    element.animate(
      [
        {
          transform: `translate(${before.x - after.x}px, ${before.y - after.y}px) ${before.transform === 'none' ? '' : before.transform} scale(${before.width / after.width}, ${before.height / after.height})`,
        },
        { transform: after.transform },
      ],
      { duration: 220, easing: 'cubic-bezier(.22,.8,.25,1)' },
    );
  }
}
