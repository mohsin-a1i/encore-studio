import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeFieldValidation, showFieldError } from '../app/form-fields.js';

function fixture(withHelp = true) {
  const help = withHelp ? { id: 'idea-help', hidden: false } : null;
  const attributes = new Map();
  let error;
  const field = {
    querySelector: (selector) => (selector === '[data-field-help]' ? help : error),
    append: (node) => {
      error = node;
    },
  };
  const input = {
    id: 'idea',
    name: 'idea',
    validationMessage: 'Please enter an idea.',
    closest: () => field,
    ownerDocument: { createElement: () => ({ dataset: {}, setAttribute() {} }) },
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: (name) => attributes.get(name),
    removeAttribute: (name) => attributes.delete(name),
    focus() {
      this.focused = true;
    },
  };
  const handlers = new Map();
  initializeFieldValidation({ addEventListener: (event, handler) => handlers.set(event, handler) });
  return { input, help, attributes, handlers, error: () => error };
}

test('validation replaces help below the field and editing restores the help and its accessible description', () => {
  const f = fixture();
  let prevented = false;
  f.handlers.get('invalid')({
    target: f.input,
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(f.input.focused, true);
  assert.equal(f.help.hidden, true);
  assert.equal(f.error().textContent, 'Please enter an idea.');
  assert.equal(f.attributes.get('aria-invalid'), 'true');
  assert.equal(f.attributes.get('aria-describedby'), 'idea-error');
  f.handlers.get('input')({ target: f.input });
  assert.equal(f.help.hidden, false);
  assert.equal(f.error().hidden, true);
  assert.equal(f.attributes.has('aria-invalid'), false);
  assert.equal(f.attributes.get('aria-describedby'), 'idea-help');
});

test('fields without help clear their error description, and repeat errors reuse the same slot', () => {
  const f = fixture(false);
  showFieldError(f.input, '<Invalid name>');
  const error = f.error();
  assert.equal(error.textContent, '<Invalid name>');
  showFieldError(f.input, 'Name already used.');
  assert.equal(f.error(), error);
  f.handlers.get('input')({ target: f.input });
  assert.equal(f.attributes.has('aria-describedby'), false);
});

test('search inputs outside form fields retain their existing validation and presentation', () => {
  const f = fixture();
  f.input.closest = () => null;
  let prevented = false;
  f.handlers.get('invalid')({
    target: f.input,
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, false);
  assert.equal(f.error(), undefined);
  assert.equal(f.attributes.size, 0);
});
