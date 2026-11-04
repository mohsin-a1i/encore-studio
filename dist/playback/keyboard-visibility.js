// Listen outside the rendered app so updates cannot restore controls over an input.
export function initializeKeyboardVisibility({ view = window, doc = document } = {}) {
  const viewport = view.visualViewport;
  if (!viewport || !view.matchMedia) return () => {};
  const touch = view.matchMedia('(hover: none) and (pointer: coarse)');
  let baseline = Math.max(view.innerHeight, viewport.height * viewport.scale);
  let keyboardOpen = false;
  const update = () => {
    const input = doc.activeElement;
    const editing =
      input &&
      !input.readOnly &&
      !input.disabled &&
      (input.isContentEditable ||
        input.matches?.(
          'textarea, input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="hidden"]):not([type="image"])',
        ));
    const height = viewport.height * viewport.scale;
    // Compare with the pre-keyboard height even in browsers that resize the layout.
    // Scaling back to CSS pixels excludes pinch zoom; browser chrome is below 120px.
    const reference = Math.max(baseline, view.innerHeight, doc.documentElement.clientHeight);
    keyboardOpen = touch.matches && (editing || keyboardOpen) && reference - height > 120;
    if (!keyboardOpen && !editing) baseline = Math.max(view.innerHeight, height);
    doc.documentElement.toggleAttribute('data-mobile-keyboard', keyboardOpen);
  };
  for (const event of ['resize', 'scroll']) viewport.addEventListener(event, update);
  for (const event of ['focusin', 'focusout']) doc.addEventListener(event, update);
  view.addEventListener('resize', update);
  touch.addEventListener('change', update);
  update();
  return () => {
    for (const event of ['resize', 'scroll']) viewport.removeEventListener(event, update);
    for (const event of ['focusin', 'focusout']) doc.removeEventListener(event, update);
    view.removeEventListener('resize', update);
    touch.removeEventListener('change', update);
    doc.documentElement.removeAttribute('data-mobile-keyboard');
  };
}
