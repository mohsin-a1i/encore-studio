import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, rename, appendFile, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RequestError } from '../server/request-security.mjs';
import { getSongFilePath } from '../songs/song-record.mjs';

const exec = promisify(execFile);
const youtubeHosts = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
]);

export function normalizeReferenceUrl(value = '') {
  if (value === '') return '';
  if (typeof value !== 'string')
    throw new RequestError(400, 'Enter a YouTube or Instagram video link.');
  if (!value.trim()) return '';
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new RequestError(400, 'Enter a complete YouTube or Instagram video link.');
  }
  const host = url.hostname.toLowerCase();
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port)
    throw new RequestError(400, 'Use a public YouTube or Instagram video link.');
  if (host === 'instagram.com' || host === 'www.instagram.com') {
    const post = url.pathname.match(/^\/(p|reel|reels|tv)\/([\w-]+)\/?$/);
    if (!post) throw new RequestError(400, 'Use an Instagram reel or video post link.');
    const type = post[1] === 'reels' ? 'reel' : post[1];
    return `https://www.instagram.com/${type}/${post[2]}/`;
  }
  const id =
    host === 'youtu.be'
      ? url.pathname.slice(1)
      : youtubeHosts.has(host)
        ? url.pathname === '/watch'
          ? url.searchParams.get('v')
          : url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)\/?$/)?.[1]
        : null;
  if (!/^[\w-]{11}$/.test(id || ''))
    throw new RequestError(400, 'Use a YouTube video or Instagram reel or video post link.');
  return `https://www.youtube.com/watch?v=${id}`;
}

async function runDownload(command, args, { signal, onStart, logFile }) {
  signal.throwIfAborted();
  const task = exec(command, args, { windowsHide: true, maxBuffer: 2_000_000 });
  let logWrites = Promise.resolve();
  const record = (chunk) => {
    logWrites = logWrites.then(() => appendFile(logFile, chunk)).catch(() => {});
  };
  task.child.stdout.on('data', record);
  task.child.stderr.on('data', record);
  let stopped = false;
  let timedOut = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (process.platform === 'win32' && task.child.pid)
      exec('taskkill', ['/PID', String(task.child.pid), '/T', '/F'], { windowsHide: true }).catch(
        () => task.child.kill(),
      );
    else task.child.kill();
  };
  const timer = setTimeout(
    () => {
      timedOut = true;
      stop();
    },
    10 * 60 * 1000,
  );
  signal.addEventListener('abort', stop, { once: true });
  onStart?.({ kill: stop });
  try {
    return await task;
  } catch (error) {
    signal.throwIfAborted();
    if (timedOut) throw new Error('The sample download took too long. Try another video.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
    await logWrites;
  }
}

export class ReferenceAudioStore {
  constructor({
    ytDlp = 'yt-dlp',
    ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg',
    ffprobe = process.env.FFPROBE_BIN || 'ffprobe',
    cookiesBrowser = process.env.YTDLP_COOKIES_BROWSER || 'edge',
    youtubeCookies = process.env.YTDLP_YOUTUBE_COOKIES ||
      fileURLToPath(new URL('../../.sites-runtime/bin/youtube-cookies.txt', import.meta.url)),
    execute = runDownload,
  } = {}) {
    Object.assign(this, { ytDlp, ffmpeg, ffprobe, cookiesBrowser, youtubeCookies, execute });
  }

  async upload(song, upload, { root, folder, signal }) {
    const name = typeof upload?.name === 'string' ? path.basename(upload.name) : '';
    const extension = path.extname(name).toLowerCase();
    if (
      !['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.webm', '.mp4'].includes(
        extension,
      )
    )
      throw new RequestError(
        400,
        'Choose an MP3, WAV, M4A, AAC, FLAC, OGG, Opus, or WebM audio file.',
      );
    if (typeof upload.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(upload.data))
      throw new RequestError(400, 'The audio upload is invalid.');
    const bytes = Buffer.from(upload.data, 'base64');
    if (!bytes.length || bytes.length > 25_000_000)
      throw new RequestError(413, 'Choose an audio file smaller than 25 MB.');
    const source = path.join(folder, 'upload-' + randomUUID() + extension);
    const relative = 'EncoreSample_' + song.id + '_' + randomUUID() + '.mp3';
    const destination = getSongFilePath(root, song, relative);
    await writeFile(source, bytes);
    try {
      await exec(this.ffmpeg, ['-v', 'error', '-i', source, '-map', '0:a:0', '-vn', destination], {
        windowsHide: true,
        signal,
        timeout: 120000,
      });
      const probe = await exec(
        this.ffprobe,
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', destination],
        { windowsHide: true, signal },
      );
      const duration = Number(JSON.parse(probe.stdout).format?.duration);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('Empty audio');
      return {
        sampleKind: 'upload',
        sampleUrl: '',
        sampleSourceUrl: '',
        sampleFile: relative,
        sampleTitle: name,
        sampleDuration: duration,
      };
    } catch (error) {
      await unlink(destination).catch(() => {});
      if (signal?.aborted) throw error;
      throw new RequestError(
        400,
        'This file could not be read as audio. Choose another audio file.',
      );
    } finally {
      await unlink(source).catch(() => {});
    }
  }

  async ensure(song, job, { root, folder, signal, save, onStart }) {
    signal.throwIfAborted();
    const url = normalizeReferenceUrl(job.input.sampleUrl);
    if (!url) {
      if (song.sampleKind !== 'upload' || !song.sampleFile) return null;
      const file = getSongFilePath(root, song, song.sampleFile);
      await access(file);
      return file;
    }
    const instagram = new URL(url).hostname === 'www.instagram.com';
    const sourceName = instagram ? 'Instagram' : 'YouTube';
    if (song.sampleFile && song.sampleSourceUrl === url) {
      const cached = getSongFilePath(root, song, song.sampleFile);
      if (
        await access(cached).then(
          () => true,
          () => false,
        )
      )
        return cached;
    }
    if (!instagram) {
      try {
        await access(this.youtubeCookies);
      } catch {
        throw new Error('Add the YouTube cookies file before loading a YouTube reference.');
      }
    }
    const args = [
      '--ignore-config',
      '--no-playlist',
      ...(instagram
        ? ['--cookies-from-browser', this.cookiesBrowser]
        : ['--cookies', this.youtubeCookies]),
      // A carousel can contain several videos; one song uses one sample.
      ...(instagram ? ['--playlist-items', '1'] : ['--js-runtimes', `node:${process.execPath}`]),
      '--extract-audio',
      '--audio-format',
      'mp3',
      '--output',
      path.join(folder, 'sample-source.%(ext)s'),
      '--print',
      'after_move:{"id":%(id)j,"title":%(title)j,"filepath":%(filepath)j}',
      ...(path.isAbsolute(this.ffmpeg) ? ['--ffmpeg-location', path.dirname(this.ffmpeg)] : []),
      '--',
      url,
    ];
    let stdout;
    try {
      ({ stdout } = await this.execute(this.ytDlp, args, {
        signal,
        onStart,
        logFile: path.join(folder, 'sample-download.log'),
      }));
    } catch (error) {
      signal.throwIfAborted();
      if (error.code === 'ENOENT')
        throw new Error(
          'yt-dlp is unavailable. Install the configured downloader before adding a sample.',
        );
      const downloadError = String(error.stderr || error.message);
      if (/failed to decrypt/i.test(downloadError))
        throw new Error(
          'yt-dlp could not decrypt the browser cookies. Use another supported browser signed in to the video service.',
        );
      if (/could not copy.*cookie database/i.test(downloadError))
        throw new Error(
          'Could not read browser cookies. Close the configured browser completely and try again.',
        );
      if (/could not find.*cookie/i.test(downloadError))
        throw new Error('Could not find cookies for the configured browser.');
      if (
        /429|not a bot|sign in|login required|log in|login.requ|rate.limit/i.test(
          String(error.stderr || error.message),
        )
      )
        throw new Error(
          `${sourceName} blocked this audio download with a rate limit or sign-in check. Try a different public video or try again later.`,
        );
      const detail = String(error.stderr || error.message)
        .split('\n')
        .filter((line) => /ERROR:/.test(line))
        .at(-1);
      throw new Error(
        detail
          ? `${sourceName} audio download failed: ${detail.slice(0, 500)}`
          : `The ${sourceName} audio could not be downloaded. Try another video.`,
      );
    }
    signal.throwIfAborted();
    const info = String(stdout)
      .trim()
      .split('\n')
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .find((item) => typeof item?.filepath === 'string');
    if (!info) throw new Error('yt-dlp did not return a downloaded audio file.');
    const source = path.resolve(info.filepath);
    if (
      path.dirname(source) !== path.resolve(folder) ||
      !/^sample-source\./.test(path.basename(source))
    )
      throw new Error('The sample download returned an unexpected file path.');
    const probe = await exec(
      this.ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', source],
      { windowsHide: true, signal },
    );
    const duration = Number(JSON.parse(probe.stdout).format?.duration);
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error('The sample audio could not be read.');
    signal.throwIfAborted();
    const relative = `EncoreSample_${song.id}_${randomUUID()}.mp3`;
    const destination = getSongFilePath(root, song, relative);
    await rename(source, destination);
    Object.assign(song, {
      sampleKind: 'link',
      sampleFile: relative,
      sampleSourceUrl: url,
      sampleTitle: String(info.title || `${sourceName} sample`),
      sampleVideoId: String(info.id || ''),
      sampleDuration: duration,
    });
    await save();
    return destination;
  }
}
