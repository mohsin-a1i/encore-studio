export function bindProfileMenus(dialog) {
  let active;
  const body = dialog.querySelector('.modal-body');

  function close(restoreFocus = false) {
    if (!active) return;
    const { toggle, menu } = active;
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.closest('.profile-row').removeAttribute('data-menu-open');
    active = null;
    if (restoreFocus) toggle.focus({ preventScroll: true });
  }

  function open(toggle, last = false) {
    close();
    const menu = toggle.nextElementSibling;
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    toggle.closest('.profile-row').setAttribute('data-menu-open', '');
    active = { toggle, menu, scrollTop: body.scrollTop };
    const box = menu.getBoundingClientRect();
    const anchor = toggle.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.right - box.width, window.innerWidth - box.width - 8));
    const below = anchor.bottom + 4;
    const top =
      below + box.height <= window.innerHeight - 8
        ? below
        : Math.max(8, anchor.top - box.height - 4);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    const items = menu.querySelectorAll('[role="menuitem"]');
    (last ? items[items.length - 1] : items[0])?.focus({ preventScroll: true });
  }

  dialog.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-profile-menu-toggle]');
    if (toggle) {
      event.preventDefault();
      if (active?.toggle === toggle) close(true);
      else open(toggle);
    } else if (!event.target.closest('.profile-menu')) close();
  });

  dialog.addEventListener('focusin', (event) => {
    if (active && !event.target.closest('.profile-card-menu')) close();
  });
  body.addEventListener(
    'scroll',
    () => {
      if (active && body.scrollTop !== active.scrollTop) close();
    },
    { passive: true },
  );

  dialog.addEventListener('keydown', (event) => {
    const toggle = event.target.closest('[data-profile-menu-toggle]');
    if (toggle && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      open(toggle, event.key === 'ArrowUp');
    } else if (active && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (active && event.key === 'Tab') {
      close();
    } else if (active && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const items = [...active.menu.querySelectorAll('[role="menuitem"]')];
      const index = items.indexOf(event.target);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus({ preventScroll: true });
    }
  });
}
