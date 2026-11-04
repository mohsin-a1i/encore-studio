export const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
export const getLyricsExcerpt = (lyrics) =>
  String(lyrics || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^\[.*\]$/.test(line))
    .slice(0, 2)
    .join(' / ');
export const formatPlaybackTime = (seconds) =>
  `${Math.floor((seconds || 0) / 60)}:${String(Math.floor((seconds || 0) % 60)).padStart(2, '0')}`;
export async function copyTextToClipboard(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const clipboardField = document.createElement('textarea');
  clipboardField.value = value;
  clipboardField.style.position = 'fixed';
  clipboardField.style.opacity = '0';
  document.body.append(clipboardField);
  clipboardField.select();
  const copied = document.execCommand('copy');
  clipboardField.remove();
  if (!copied) throw new Error('Select and copy the lyrics from the song details.');
}
