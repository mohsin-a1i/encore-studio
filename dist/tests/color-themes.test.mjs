import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.document = { querySelector: () => ({}) };
globalThis.sessionStorage = { getItem: () => null };
globalThis.localStorage = { getItem: () => null };
globalThis.location = { hostname: 'localhost', origin: 'http://localhost:4318' };
const { createThemeManager, themes, defaultTheme, closestTheme } =
  await import('../settings/color-themes.js');
const { updateBrowserTheme } = await import('../settings/theme-favicon.js');
const { dominantCoverHue, hexToHsl } = await import('../settings/cover-palette.js');

function fixture({ saved, loadCoverHue = async () => 24, onApply } = {}) {
  const values = new Map(saved ? [['encore-theme', saved]] : []);
  const properties = new Map();
  const root = {
    dataset: {},
    style: { setProperty: (key, value) => properties.set(key, String(value)) },
  };
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const manager = createThemeManager({
    root,
    storage,
    loadCoverHue,
    coverUrl: (song) => song.cover,
    onApply,
  });
  return { manager, root, properties, values };
}

function luminance(css) {
  let [hue, saturation, lightness] = css.startsWith('#')
    ? (() => {
        const { h, s, l } = hexToHsl(css);
        return [h, s * 100, l * 100];
      })()
    : css.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const h = ((hue % 360) + 360) % 360;
  const s = Math.min(1, saturation / 100),
    l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return channel(0) * 0.2126 + channel(8) * 0.7152 + channel(4) * 0.0722;
}
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

test('primary and destructive button colors meet contrast across presets and Magic palettes', () => {
  const css = readFileSync(new URL('../app/base.css', import.meta.url), 'utf8');
  const baseTokens = [...css.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [
    match[1],
    match[2],
  ]);
  for (const palette of themes.filter((theme) => theme.id !== 'magic')) {
    const { hue, saturation = 1 } = palette;
    const tokens = new Map([
      ...baseTokens,
      ['--theme-hue', String(hue)],
      ['--theme-saturation', String(saturation)],
      ['--accent', palette.accent],
      ['--button-primary-bg', palette.fill],
      ['--button-primary-hover', palette.hover],
    ]);
    const expand = (value) =>
      value.replace(/var\((--[\w-]+)\)/g, (_, token) => expand(tokens.get(token)));
    const color = (token) =>
      expand(tokens.get(token)).replace(
        /calc\(\s*(-?[\d.]+)(%?)\s*([+*-])\s*(-?[\d.]+)(%?)\s*\)/g,
        (_, first, firstUnit, operation, second, secondUnit) =>
          String(
            operation === '+'
              ? Number(first) + Number(second)
              : operation === '-'
                ? Number(first) - Number(second)
                : Number(first) * Number(second),
          ) + (firstUnit || secondUnit),
      );
    const ratio = (first, second) => contrast(luminance(color(first)), luminance(color(second)));
    for (const [text, background] of [
      ['--on-accent', '--button-primary-bg'],
      ['--on-accent', '--button-primary-hover'],
      ['--muted', '--highlight'],
      ['--on-accent', '--danger-bg'],
      ['--on-accent', '--danger-hover'],
    ])
      assert.ok(ratio(text, background) >= 4.5, `${text} on ${background}: hue ${hue}`);
    assert.equal(color('--bg'), '#000');
    const surfaces = ['--bg', '--panel', '--surface'].map(color);
    for (const surface of surfaces) {
      for (const border of ['--button-primary-bg', '--danger-bg'])
        assert.ok(
          contrast(luminance(color(border)), luminance(surface)) >= 3,
          `${border} boundary: hue ${hue}`,
        );
    }
  }
});

test('every preset stays dark with readable text and primary controls', () => {
  const palettes = [...themes.filter((theme) => theme.id !== 'magic')];
  for (const palette of palettes) {
    const accent = hexToHsl(palette.accent);
    if (palette.saturation === 0) assert.equal(accent.s, 0);
    else {
      assert.ok(accent.s >= 0.65, `Saturated accent for ${palette.name}`);
      assert.ok(accent.l <= 0.7, `Accent is not pastel for ${palette.name}`);
    }
    assert.ok(contrast(luminance('#fff'), luminance(palette.fill)) >= 4.5);
  }
});

test('application styles use the shared palette instead of individual color values', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.css') || entry.name === 'base.css') continue;
    const file = path.join(entry.parentPath, entry.name);
    const css = readFileSync(file, 'utf8');
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\b(?:hsl|hsla|rgb|rgba|color-mix)\(/i, file);
  }
});

test('Magic reads the dominant color while ignoring transparent and neutral pixels', () => {
  const pixels = new Uint8ClampedArray([
    ...Array(40).fill([220, 40, 60, 255]).flat(),
    ...Array(20).fill([35, 80, 220, 255]).flat(),
    ...Array(80).fill([255, 255, 255, 255]).flat(),
    ...Array(40).fill([0, 0, 0, 255]).flat(),
    ...Array(100).fill([255, 255, 0, 0]).flat(),
  ]);
  const hue = dominantCoverHue(pixels);
  assert.ok(hue > 345 && hue < 360);
  assert.equal(closestTheme(hue).id, 'crimson-stage');
  const monochrome = dominantCoverHue(
    new Uint8ClampedArray([100, 100, 100, 255, 240, 240, 240, 255]),
  );
  assert.equal(monochrome, null);
  assert.equal(closestTheme(monochrome).id, 'silver-silence');
  assert.equal(closestTheme(220).id, 'blue-nocturne');
  assert.equal(closestTheme(35).id, 'gilded-hour');
  assert.equal(closestTheme(24).id, 'copper-glow');
  assert.equal(closestTheme(276).id, 'velvet-nebula');
  assert.equal(closestTheme(360).id, 'crimson-stage');
  assert.equal(closestTheme(-5).id, 'crimson-stage');
});

test('Magic is the default while saved theme choices are preserved', async () => {
  assert.deepEqual(
    themes.map((theme) => theme.id),
    [
      'gilded-hour',
      'crimson-stage',
      'blue-nocturne',
      'copper-glow',
      'velvet-nebula',
      'silver-silence',
      'magic',
    ],
  );
  const fresh = fixture();
  await fresh.manager.sync(null);
  assert.equal(fresh.manager.selection, 'magic');
  assert.equal(fresh.properties.get('--theme-hue'), '220');
  assert.equal(fresh.properties.get('--theme-saturation'), '0');
  const f = fixture({ saved: 'blue-nocturne' });
  await f.manager.sync(null);
  assert.equal(f.root.dataset.theme, 'blue-nocturne');
  assert.equal(f.properties.get('--theme-hue'), '218');
  await f.manager.select('copper-glow');
  assert.equal(f.values.get('encore-theme'), 'copper-glow');
  assert.equal(f.properties.get('--theme-hue'), '24');
  assert.equal(fixture({ saved: 'unknown' }).manager.selection, 'magic');
  assert.equal(fixture({ saved: 'rose' }).manager.selection, 'magic');
  assert.equal(fixture({ saved: 'magic' }).manager.selection, 'magic');
});

test('Magic follows song and cover changes, caches colors, and handles paused/renamed songs without another download', async () => {
  const calls = [];
  const f = fixture({
    saved: 'magic',
    loadCoverHue: async (url) => {
      calls.push(url);
      return 230;
    },
  });
  const first = { id: 'first', title: 'First', cover: '/cover/first?v=1' };
  await f.manager.sync(first);
  await f.manager.sync(first);
  await f.manager.sync({ ...first, title: 'Renamed' });
  assert.equal(f.manager.info.title, 'Renamed');
  assert.equal(calls.length, 1);
  await f.manager.sync({ id: 'next', title: 'Next', cover: '/cover/next' });
  await f.manager.sync(first);
  assert.equal(calls.length, 2);
  await f.manager.sync({ ...first, cover: '/cover/first?v=2' });
  assert.equal(calls.length, 3);
  await f.manager.sync(null);
  assert.equal(f.manager.info.status, 'waiting');
  assert.equal(f.root.dataset.theme, 'magic');
  assert.equal(Number(f.properties.get('--theme-hue')), defaultTheme.hue);
});

test('a stale cover load cannot override the next song or a manually chosen theme', async () => {
  const pending = new Map();
  const f = fixture({
    saved: 'magic',
    loadCoverHue: (url, signal) => new Promise((resolve) => pending.set(url, { resolve, signal })),
  });
  const first = f.manager.sync({ title: 'First', cover: '/first' });
  const next = f.manager.sync({ title: 'Next', cover: '/next' });
  assert.equal(pending.get('/first').signal.aborted, true);
  pending.get('/next').resolve(220);
  await next;
  pending.get('/first').resolve(10);
  await first;
  assert.equal(f.properties.get('--theme-hue'), '218');
  assert.equal(f.manager.info.theme, 'Blue Nocturne');
  const late = f.manager.sync({ title: 'Late', cover: '/late' });
  await f.manager.select('velvet-nebula');
  pending.get('/late').resolve(120);
  await late;
  assert.equal(f.properties.get('--theme-hue'), '276');
  assert.equal(f.root.dataset.theme, 'velvet-nebula');
});

test('an unreadable cover keeps the app usable and a new cover can still set its colors', async () => {
  const f = fixture({
    saved: 'magic',
    loadCoverHue: async (url) => {
      if (url === '/broken') throw new Error('Cover unavailable');
      return 24;
    },
  });
  await f.manager.sync({ title: 'Broken', cover: '/broken' });
  assert.equal(f.manager.info.status, 'unavailable');
  assert.equal(Number(f.properties.get('--theme-hue')), defaultTheme.hue);
  await f.manager.sync({ title: 'Working', cover: '/working' });
  assert.equal(f.manager.info.status, 'ready');
  assert.equal(f.properties.get('--theme-hue'), '24');
  assert.equal(f.manager.info.theme, 'Copper Glow');
});

test('a monochrome cover uses neutral Silver Silence and switching back restores color', async () => {
  const f = fixture({ saved: 'magic', loadCoverHue: async () => null });
  await f.manager.sync({ title: 'Monochrome', cover: '/mono' });
  assert.equal(f.manager.selection, 'magic');
  assert.equal(f.manager.info.theme, 'Silver Silence');
  assert.equal(f.properties.get('--theme-hue'), '220');
  assert.equal(f.properties.get('--theme-saturation'), '0');
  await f.manager.select('gilded-hour');
  assert.equal(f.properties.get('--theme-saturation'), '1');
});

test('favicon and browser color follow presets, Magic cover colors, and its Silver Silence fallback', async () => {
  const icon = {},
    browserColor = {};
  const page = {
    querySelector: (selector) => (selector.startsWith('link') ? icon : browserColor),
  };
  const f = fixture({ onApply: (palette) => updateBrowserTheme(palette, page) });
  await f.manager.sync(null);
  const goldIcon = icon.href;
  const svg = () => decodeURIComponent(icon.href.slice('data:image/svg+xml,'.length));
  assert.ok(svg().includes(`fill="${defaultTheme.fill}"`));
  assert.ok(svg().includes('stroke="#fff"'));
  assert.equal(browserColor.content, '#000000');
  await f.manager.select('blue-nocturne');
  assert.notEqual(icon.href, goldIcon);
  await f.manager.select('magic');
  assert.equal(icon.href, goldIcon);
  await f.manager.sync({ title: 'A cover', cover: '/cover' });
  assert.ok(svg().includes(`fill="${themes.find((theme) => theme.id === 'copper-glow').fill}"`));
  assert.equal(browserColor.content, '#000000');
  await f.manager.sync(null);
  assert.equal(icon.href, goldIcon);
});
