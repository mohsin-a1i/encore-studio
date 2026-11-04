import { publicProfile, workspace } from '../profiles/profile-workspace.mjs';
import { exploreSnapshot } from '../explore/explore-state.mjs';
import { serializeSong, serializePlaylist } from './api-responses.mjs';
import { ownerProfileId } from '../profiles/profile-records.mjs';

export function librarySnapshot(state, profileId) {
  const owned = state.songs.filter((song) => ownerProfileId(song) === profileId);
  const profile = state.profiles.find((profile) => profile.id === profileId);
  return {
    revision: state.revision || 0,
    profile: profile ? publicProfile(profile) : undefined,
    profiles: state.profiles.map(publicProfile),
    profilePreferences: profile ? workspace(profile).preferences : undefined,
    preferenceRevision: profile ? workspace(profile).preferenceRevision : 0,
    explore: profile ? exploreSnapshot(profile, owned) : undefined,
    songs: owned.filter((song) => !song.temporary).map(serializeSong),
    exploreSongs: owned.filter((song) => song.temporary).map(serializeSong),
    playlists: state.playlists
      .filter((playlist) => ownerProfileId(playlist) === profileId)
      .map(serializePlaylist),
    deletedSongIds: state.deletedSongIds.filter(
      (id) => state.deletedSongProfiles[id] === profileId,
    ),
  };
}
