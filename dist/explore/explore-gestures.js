export function initializeExploreGestures(root, vote, isBusy, refresh = () => {}) {
  let drag = null;
  let exiting = false;
  async function animateExit(direction, card = root.querySelector?.('[data-explore-card]')) {
    if (!card || exiting || isBusy()) return;
    exiting = true;
    card.dataset.dragging = 'true';
    card.dataset.exiting = direction;
    const deck = card.closest?.('.explore-deck');
    let animation;
    if (deck) deck.dataset.exiting = direction;
    try {
      if (!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches && card.animate) {
        const sign = direction === 'right' ? 1 : -1;
        animation = card.animate(
          [
            { transform: card.style.transform || 'none', opacity: 1 },
            {
              transform: `translateX(${sign * 100}px) rotate(${sign * 6}deg)`,
              opacity: 0,
            },
          ],
          { duration: 220, easing: 'cubic-bezier(.25,.7,.25,1)', fill: 'forwards' },
        );
        await animation.finished.catch(() => {});
      }
    } finally {
      delete card.dataset.dragging;
      delete card.dataset.exiting;
      if (deck) delete deck.dataset.exiting;
      animation?.cancel();
      card.style.transform = '';
      const hint = card.querySelector?.('[data-swipe-hint]');
      if (hint) hint.textContent = '';
      exiting = false;
      refresh();
    }
  }
  function decide(direction, card = root.querySelector?.('[data-explore-card]')) {
    if (!card || exiting || isBusy()) return;
    const animation = animateExit(direction, card);
    // State and playback advance independently of the animation's completion.
    void vote(direction);
    return animation;
  }
  function reset() {
    if (!drag) return;
    const from = drag.card.style.transform;
    drag.card.style.transform = '';
    if (
      from &&
      drag.card.animate &&
      !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    )
      drag.card.animate([{ transform: from }, { transform: 'none' }], {
        duration: 160,
        easing: 'ease-out',
      });
    delete drag.card.dataset.dragging;
    delete drag.card.dataset.direction;
    const hint = drag.card.querySelector('[data-swipe-hint]');
    if (hint) hint.textContent = '';
    drag = null;
  }
  function begin(target, x, y, id, kind) {
    const card = target.closest('[data-explore-card]');
    if (!card || target.closest('button') || isBusy() || exiting) return;
    const base = globalThis.getComputedStyle?.(card).transform || 'none';
    for (const animation of card.getAnimations?.() || []) animation.cancel();
    card.style.transform = base === 'none' ? '' : base;
    card.dataset.dragging = 'true';
    drag = { card, x, y, id, kind, axis: null, base };
    if (kind === 'pointer') card.setPointerCapture(id);
  }
  function move(x, y) {
    if (!drag) return false;
    const dx = x - drag.x;
    const dy = y - drag.y;
    if (!drag.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return false;
      if (Math.abs(dy) > Math.abs(dx)) {
        reset();
        return false;
      }
      drag.axis = 'horizontal';
    }
    drag.card.dataset.dragging = 'true';
    drag.card.dataset.direction = dx > 0 ? 'right' : 'left';
    drag.card.style.transform = `translateX(${dx}px) rotate(${Math.max(-8, Math.min(8, dx / 30))}deg) ${drag.base === 'none' ? '' : drag.base}`;
    drag.card.querySelector('[data-swipe-hint]').textContent =
      dx > 0 ? 'Save to library' : 'Skip song';
    return true;
  }
  function finish(x, y) {
    if (!drag) return;
    const dx = x - drag.x;
    const dy = y - drag.y;
    const swipe =
      Math.abs(dx) >= 70 && (drag.axis === 'horizontal' || Math.abs(dx) > Math.abs(dy) * 1.3);
    if (swipe && !isBusy()) {
      const card = drag.card;
      drag = null;
      void decide(dx > 0 ? 'right' : 'left', card);
    } else reset();
  }
  // Touch scrolling must be cancelled through a non-passive touchmove listener.
  // Pointer capture alone cannot stop the browser taking over a vertical pan.
  root.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length !== 1) return reset();
      const touch = event.touches[0];
      begin(event.target, touch.clientX, touch.clientY, touch.identifier, 'touch');
    },
    { passive: true },
  );
  root.addEventListener(
    'touchmove',
    (event) => {
      if (drag?.kind !== 'touch') return;
      if (event.touches.length !== 1) return reset();
      const touch = [...event.touches].find((item) => item.identifier === drag.id);
      if (touch && move(touch.clientX, touch.clientY) && event.cancelable) event.preventDefault();
    },
    { passive: false },
  );
  root.addEventListener(
    'touchend',
    (event) => {
      if (drag?.kind !== 'touch') return;
      const touch = [...event.changedTouches].find((item) => item.identifier === drag.id);
      if (!touch) return;
      if (drag.axis === 'horizontal' && event.cancelable) event.preventDefault();
      finish(touch.clientX, touch.clientY);
    },
    { passive: false },
  );
  root.addEventListener('touchcancel', () => {
    if (drag?.kind === 'touch') reset();
  });
  root.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') return;
    if (event.isPrimary === false) return reset();
    if (event.button === 0)
      begin(event.target, event.clientX, event.clientY, event.pointerId, 'pointer');
  });
  root.addEventListener('pointermove', (event) => {
    if (drag?.kind === 'pointer' && drag.id === event.pointerId) move(event.clientX, event.clientY);
  });
  root.addEventListener('pointerup', (event) => {
    if (drag?.kind === 'pointer' && drag.id === event.pointerId)
      finish(event.clientX, event.clientY);
  });
  for (const event of ['pointercancel', 'lostpointercapture'])
    root.addEventListener(event, () => {
      if (drag?.kind === 'pointer') reset();
    });
  root.addEventListener('keydown', (event) => {
    if (
      !event.target.matches('[data-explore-card]') ||
      !['ArrowLeft', 'ArrowRight'].includes(event.key)
    )
      return;
    event.preventDefault();
    if (!event.repeat && !isBusy())
      void decide(event.key === 'ArrowRight' ? 'right' : 'left', event.target);
  });
  return { decide, animateExit };
}
