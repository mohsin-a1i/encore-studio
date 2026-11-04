export function getSongGenres(song) {
  return Array.isArray(song.genres) ? song.genres : song.genre ? [song.genre] : [];
}
