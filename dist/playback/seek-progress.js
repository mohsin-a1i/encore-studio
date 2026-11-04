export function getSeekFraction(value, maximum) {
  const duration = Number(maximum);
  const position = Number(value);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return 0;
  return Math.min(1, Math.max(0, position / duration));
}

export function updateSeekProgress(input) {
  input
    ?.closest('.seek-bar')
    ?.style.setProperty('--seek-fraction', String(getSeekFraction(input.value, input.max)));
}
