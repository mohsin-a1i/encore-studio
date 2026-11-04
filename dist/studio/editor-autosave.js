import { studioState, songEdits, findSongById } from '../app/browser-state.js';
import { isSongGenerating } from '../songs/song-status.js';
import { encodeReferenceInput } from './reference-input.js';
import { createRequestId } from '../app/request-id.js';
import { readDevice, writeDevice } from '../app/device-state.js';

const savedFields = ['title', 'style', 'lyrics', 'sampleUrl', 'sampleUpload', 'removeSample'];
const textFields = ['title', 'style', 'lyrics', 'sampleUrl'];
export function createEditorAutosave({
  requestStudio,
  onSaved = () => {},
  onError = () => {},
  delay = 600,
}) {
  const saves = new Map();
  function status(entry, text, conflict = false) {
    entry.conflict = conflict;
    if (studioState.profileId !== entry.profileId) return;
    studioState.editorConflictId = conflict ? entry.id : null;
    const form = entry.form;
    const target = form?.querySelector?.('[data-editor-save-status]');
    if (target) target.textContent = text;
    const actions = form?.querySelector?.('[data-editor-conflict]');
    if (actions) actions.hidden = !conflict;
  }
  function capture(form) {
    if (!form) return;
    const id = form.dataset.id;
    const song = id ? findSongById(id) : null;
    if (song && isSongGenerating(song)) return;
    const edits = id
      ? songEdits.get(id) || {}
      : {
          title: studioState.draftTitle || '',
          style: studioState.draftStyle || '',
          lyrics: studioState.draftLyrics || '',
          sampleUrl: studioState.sampleUrl || '',
          sampleUpload: studioState.sampleUpload,
          removeSample: studioState.removeSample,
        };
    const snapshot = Object.fromEntries(
      savedFields.filter((key) => edits[key] !== undefined).map((key) => [key, edits[key]]),
    );
    if (
      !Object.keys(snapshot).length ||
      (!id && !textFields.some((key) => snapshot[key]?.trim()) && !snapshot.sampleUpload)
    )
      return;
    const draftId = id ? null : (studioState.draftRequestId ||= createRequestId());
    const key = `${studioState.profileId}:${id || 'new:' + draftId}`;
    const entry = saves.get(key) || {
      id,
      draftId,
      profileId: studioState.profileId,
      requestId: draftId || createRequestId(),
      running: Promise.resolve(),
    };
    entry.form = form;
    if (!entry.saving)
      entry.baseRevision =
        edits._baseRevision ?? Number(form.dataset.editRevision ?? song?.editRevision ?? 0);
    writeDevice(
      `recovery:${id || 'new'}`,
      {
        songId: id || null,
        baseRevision: entry.baseRevision,
        fields: Object.fromEntries(
          textFields
            .filter((key) => snapshot[key] !== undefined)
            .map((key) => [key, snapshot[key]]),
        ),
      },
      entry.profileId,
    );
    if (
      entry.saving &&
      Object.keys(snapshot).length === Object.keys(entry.saving).length &&
      Object.entries(snapshot).every(([key, value]) => entry.saving[key] === value)
    ) {
      clearTimeout(entry.timer);
      entry.pending = null;
      return entry;
    }
    entry.pending = snapshot;
    clearTimeout(entry.timer);
    saves.set(key, entry);
    return entry;
  }
  function persist(entry) {
    clearTimeout(entry.timer);
    if (entry.conflict)
      return Promise.reject(
        Object.assign(new Error('Resolve the conflict before saving.'), { status: 409 }),
      );
    const snapshot = entry.pending;
    if (!snapshot) return entry.running;
    entry.pending = null;
    entry.saving = snapshot;
    status(entry, 'Saving…');
    entry.running = entry.running
      .catch(() => {})
      .then(async () => {
        const input = Object.fromEntries(
          textFields
            .slice(0, 3)
            .filter((key) => key in snapshot)
            .map((key) => [key, snapshot[key]]),
        );
        if (['sampleUrl', 'sampleUpload', 'removeSample'].some((key) => key in snapshot))
          Object.assign(input, await encodeReferenceInput(snapshot.sampleUrl || '', snapshot));
        const creating = !entry.id;
        if (creating) input.kind = 'draft';
        else input.baseRevision = entry.baseRevision;
        const updated = await requestStudio(creating ? 'songs' : `songs/${entry.id}`, {
          method: creating ? 'POST' : 'PATCH',
          headers: {
            'X-Profile-Id': entry.profileId,
            'X-Request-Id': entry.requestId,
          },
          body: JSON.stringify(input),
        });
        entry.baseRevision = updated.editRevision || 0;
        if (entry.form && studioState.profileId === entry.profileId)
          entry.form.dataset.editRevision = String(entry.baseRevision);
        if (creating) {
          entry.id = updated.id;
          saves.set(`${entry.profileId}:${entry.id}`, entry);
          if (saves.get(`${entry.profileId}:new:${entry.draftId}`) === entry)
            saves.delete(`${entry.profileId}:new:${entry.draftId}`);
          writeDevice('recovery:new', null, entry.profileId);
        }
        if (studioState.profileId !== entry.profileId) return;
        if (creating) {
          if (!findSongById(updated.id)) studioState.songs.unshift(updated);
          // Bind only the form that initiated creation; never replace a later new draft.
          if (
            entry.form?.isConnected !== false &&
            !entry.form.dataset.id &&
            studioState.draftRequestId === entry.draftId
          ) {
            entry.form.dataset.id = updated.id;
            entry.form.removeAttribute?.('data-new-song');
            studioState.selectedSongId = updated.id;
            if (studioState.modal?.kind === 'auto-complete' && !studioState.modal.id) {
              studioState.modal.id = updated.id;
              const dialog = globalThis.document?.querySelector?.('#auto-complete-form');
              if (dialog) dialog.dataset.id = updated.id;
            }
            studioState.composingSong = false;
            writeDevice('song-id', updated.id, entry.profileId);
            const newer = {
              title: studioState.draftTitle,
              style: studioState.draftStyle,
              lyrics: studioState.draftLyrics,
              sampleUrl: studioState.sampleUrl,
            };
            songEdits.set(
              updated.id,
              Object.fromEntries(
                Object.entries(newer).filter(([key, value]) => value !== snapshot[key]),
              ),
            );
          }
        }
        const song = findSongById(entry.id);
        if (!song) return;
        Object.assign(song, updated);
        const edits = songEdits.get(entry.id);
        if (edits) {
          for (const [key, value] of Object.entries(snapshot))
            if (edits[key] === value) delete edits[key];
          if (savedFields.some((key) => edits[key] !== undefined))
            edits._baseRevision = entry.baseRevision;
          else {
            delete edits._baseRevision;
            if (!Object.keys(edits).length) songEdits.delete(entry.id);
          }
        }
        const remaining = songEdits.get(entry.id);
        if (remaining && textFields.some((key) => remaining[key] !== undefined))
          writeDevice(
            `recovery:${entry.id}`,
            {
              songId: entry.id,
              baseRevision: entry.baseRevision,
              fields: Object.fromEntries(
                textFields
                  .filter((key) => remaining[key] !== undefined)
                  .map((key) => [key, remaining[key]]),
              ),
            },
            entry.profileId,
          );
        else writeDevice(`recovery:${entry.id}`, null, entry.profileId);
        status(entry, 'Saved');
        onSaved(song);
      })
      .catch((error) => {
        status(
          entry,
          error.status === 409 ? 'Changed on another device' : 'Not saved',
          error.status === 409,
        );
        throw error;
      })
      .finally(() => {
        if (entry.saving === snapshot) entry.saving = null;
      });
    return entry.running;
  }
  function scheduleEditorSave(form) {
    const entry = capture(form);
    if (entry) entry.timer = setTimeout(() => persist(entry).catch(onError), delay);
  }
  async function flushEditorSave(form) {
    const entry =
      capture(form) ||
      saves.get(
        `${studioState.profileId}:${form?.dataset.id || 'new:' + studioState.draftRequestId}`,
      );
    if (entry) await persist(entry);
  }
  async function resolveEditorConflict(form, keepEdits) {
    const id = form.dataset.id;
    const profileId = studioState.profileId;
    const entry = saves.get(`${studioState.profileId}:${id}`);
    if (entry) {
      clearTimeout(entry.timer);
      await entry.running.catch(() => {});
      if (profileId !== studioState.profileId) return;
      entry.saving = null;
      entry.pending = null;
      entry.conflict = false;
      entry.baseRevision = findSongById(id)?.editRevision || 0;
    }
    if (keepEdits) {
      const edits = songEdits.get(id) || {};
      edits._baseRevision = findSongById(id)?.editRevision || 0;
      songEdits.set(id, edits);
      await flushEditorSave(form);
    } else {
      songEdits.delete(id);
      writeDevice(`recovery:${id}`, null, studioState.profileId);
    }
    studioState.editorConflictId = null;
  }
  function recoverEditor(form, sourceId = null) {
    const recovery = readDevice(
      `recovery:${sourceId || form.dataset.id || 'new'}`,
      null,
      studioState.profileId,
    );
    if (!recovery) return;
    for (const [key, value] of Object.entries(recovery.fields))
      if (form.elements[key]) form.elements[key].value = value;
    if (form.dataset.id)
      songEdits.set(form.dataset.id, {
        ...recovery.fields,
        _baseRevision: recovery.baseRevision,
      });
    else
      Object.assign(studioState, {
        draftTitle: recovery.fields.title || '',
        draftStyle: recovery.fields.style || '',
        draftLyrics: recovery.fields.lyrics || '',
        sampleUrl: recovery.fields.sampleUrl || '',
      });
    if (sourceId) {
      studioState.draftRequestId = createRequestId();
      studioState.deletedEditorId = null;
    }
    scheduleEditorSave(form);
  }
  return {
    scheduleEditorSave,
    flushEditorSave,
    resolveEditorConflict,
    recoverEditor,
  };
}
