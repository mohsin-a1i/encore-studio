import { studioOrigin } from './browser-state.js';

let toastTimer;

export function mediaUrl(src) {
  if (!src) return 'favicon.svg';
  if (src.startsWith('api/')) return studioOrigin + '/' + src;
  return new URL(src, location.href).href;
}
export function showToast(message) {
  const box = document.querySelector('#toast');
  box.textContent = message;
  box.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('visible'), 4200);
}
