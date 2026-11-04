// Membership changes never delete the song or replace the playlist's other songs.
export async function updatePlaylistMembership(requestStudio, playlist, songId, included) {
  if (playlist.songIds.includes(songId) === included) return playlist;
  if (included)
    return requestStudio('playlists/' + playlist.id, {
      method: 'PATCH',
      body: JSON.stringify({ addSongIds: [songId] }),
    });
  await requestStudio('playlists/' + playlist.id + '/songs/' + songId, {
    method: 'DELETE',
  });
  return {
    ...playlist,
    songIds: playlist.songIds.filter((id) => id !== songId),
  };
}
