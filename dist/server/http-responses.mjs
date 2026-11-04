import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { RequestError } from './request-security.mjs';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
};
export const sendJsonResponse = (response, status, data) => {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...(response.getStateRevision
      ? { 'X-State-Revision': String(response.getStateRevision()) }
      : {}),
  });
  response.end(JSON.stringify(data));
};
export async function readJsonBody(request, limit = 4_500_000) {
  let buffer = '';
  for await (const chunk of request) {
    buffer += chunk;
    if (buffer.length > limit) throw new RequestError(413, 'This upload is too large.');
  }
  try {
    return JSON.parse(buffer || '{}');
  } catch {
    throw new RequestError(400, 'Invalid request.');
  }
}
export async function streamMediaFile(request, response, file, download) {
  let size;
  try {
    size = (await stat(file)).size;
  } catch {
    throw new RequestError(404, 'File not found.');
  }
  const ext = path.extname(file).toLowerCase();
  const headers = {
    'Content-Type': mime[ext] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': ['.html', '.js', '.css', '.json'].includes(ext)
      ? 'no-cache'
      : 'private, max-age=3600',
  };
  if (download)
    headers['Content-Disposition'] =
      `attachment; filename="${download.replace(/[^a-zA-Z0-9 ._-]/g, '')}"`;
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      response.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return response.end();
    }
    let start = Number(match[1] || 0),
      end = match[2] ? Number(match[2]) : size - 1;
    if (!match[1] && match[2]) {
      start = Math.max(0, size - Number(match[2]));
      end = size - 1;
    }
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      response.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return response.end();
    }
    response.writeHead(206, {
      ...headers,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${size}`,
    });
    createReadStream(file, { start, end }).pipe(response);
  } else {
    response.writeHead(200, { ...headers, 'Content-Length': size });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).pipe(response);
  }
}
