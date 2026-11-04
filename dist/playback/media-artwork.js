export const mediaArtworkSizes = Object.freeze([96, 128, 192, 256, 384, 512]);

export function getMediaArtwork(cover, resolveUrl) {
  if (!cover) return [];
  const url = new URL(resolveUrl(cover));
  if (!/\/api\/cover\/song\/[^/]+$/.test(url.pathname)) return [{ src: url.href }];
  return mediaArtworkSizes.map((size) => {
    const image = new URL(url);
    image.pathname += `/media/${size}.png`;
    return { src: image.href, sizes: `${size}x${size}`, type: 'image/png' };
  });
}
