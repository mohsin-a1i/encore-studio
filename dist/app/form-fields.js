export function syncFieldFeedback(input, help, error) {
  if (!input) return;
  const invalid = Boolean(error && !error.hidden && error.textContent?.trim());
  if (help) help.hidden = invalid;
  if (invalid) input.setAttribute?.('aria-invalid', 'true');
  else input.removeAttribute?.('aria-invalid');
  const message = invalid ? error : help;
  if (message?.id) input.setAttribute?.('aria-describedby', message.id);
  else if (input.getAttribute?.('aria-describedby')) input.removeAttribute('aria-describedby');
}

export function showFieldError(input, message) {
  const field = input?.closest?.('.field');
  if (!field) return false;
  let error = field.querySelector('[data-field-error]');
  if (!error) {
    error = input.ownerDocument.createElement('span');
    error.className = 'field-message field-error';
    error.dataset.fieldError = '';
    error.setAttribute('role', 'alert');
    error.id = `${input.id || input.name}-error`;
    field.append(error);
  }
  error.textContent = message;
  error.hidden = false;
  syncFieldFeedback(input, field.querySelector('[data-field-help]'), error);
  return true;
}

export function initializeFieldValidation(root = document) {
  root.addEventListener(
    'invalid',
    (event) => {
      if (showFieldError(event.target, event.target.validationMessage)) {
        event.preventDefault();
        event.target.focus?.();
      }
    },
    true,
  );
  root.addEventListener('input', (event) => {
    const field = event.target.closest?.('.field');
    const error = field?.querySelector('[data-field-error]');
    if (!error || error.hidden) return;
    error.hidden = true;
    syncFieldFeedback(event.target, field.querySelector('[data-field-help]'), error);
  });
}
