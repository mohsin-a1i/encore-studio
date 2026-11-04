export function rgbToHsl(red, green, blue) {
  [red, green, blue] = [red, green, blue].map((channel) => channel / 255);
  const brightestChannel = Math.max(red, green, blue);
  const darkestChannel = Math.min(red, green, blue);
  const channelRange = brightestChannel - darkestChannel;
  const lightness = (brightestChannel + darkestChannel) / 2;
  if (!channelRange) return { h: 0, s: 0, l: lightness };
  const saturation = channelRange / (1 - Math.abs(2 * lightness - 1));
  let hue =
    brightestChannel === red
      ? ((green - blue) / channelRange) % 6
      : brightestChannel === green
        ? (blue - red) / channelRange + 2
        : (red - green) / channelRange + 4;
  hue = (hue * 60 + 360) % 360;
  return { h: hue, s: saturation, l: lightness };
}

export function hexToHsl(hex) {
  let value = hex.replace('#', '');
  if (value.length < 5) value = [...value].map((char) => char + char).join('');
  const rgb = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
  return { ...rgbToHsl(...rgb), a: value.length === 8 ? parseInt(value.slice(6), 16) / 255 : 1 };
}

/** Find the dominant cover hue, ignoring transparent and nearly neutral pixels. */
export function dominantCoverHue(pixels) {
  const buckets = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const color = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (color.l < 0.08 || color.l > 0.94 || color.s < 0.1) continue;
    const weight = color.s * (0.5 + Math.min(color.l, 1 - color.l));
    const key = Math.round(color.h / 15) % 24;
    const bucket = buckets.get(key) || { weight: 0, x: 0, y: 0 };
    bucket.weight += weight;
    bucket.x += Math.cos((color.h * Math.PI) / 180) * weight;
    bucket.y += Math.sin((color.h * Math.PI) / 180) * weight;
    buckets.set(key, bucket);
  }
  const strongest = [...buckets.values()].sort((a, b) => b.weight - a.weight)[0];
  return strongest ? ((Math.atan2(strongest.y, strongest.x) * 180) / Math.PI + 360) % 360 : null;
}
