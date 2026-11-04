/** Original, self-contained SVG cover artwork. No remote fonts or images. */
import { themes } from '../settings/theme-palettes.js';

export const coverPaletteIds = themes.map(({ id }) => id);
const paletteForTheme = (theme) => {
  if (theme.id === 'magic') return ['#061329', '#1647d9', '#ff3d9e', '#38f2d0', '#f7f4ff'];
  if (theme.saturation === 0) return ['#090909', '#414141', '#d0d0d0', '#ffffff', '#f5f5f5'];
  const h = theme.hue;
  return [
    `hsl(${h} 72% 9%)`,
    `hsl(${h} 82% 33%)`,
    theme.accent,
    `hsl(${h + 12} 100% 78%)`,
    `hsl(${h} 40% 96%)`,
  ];
};
const PALETTES = themes.map(paletteForTheme);

const escapeXml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character],
  );
// Deterministic colors and geometry keep a song's generated artwork consistent.
const hashCoverSeed = (value) => {
  let hashValue = 2166136261;
  for (const character of String(value))
    hashValue = Math.imul(hashValue ^ character.charCodeAt(0), 16777619);
  return hashValue >>> 0;
};
const createSeededRandom = (seed) => {
  let randomState = seed >>> 0;
  return () => {
    randomState += 0x6d2b79f5;
    let mixedValue = randomState;
    mixedValue = Math.imul(mixedValue ^ (mixedValue >>> 15), mixedValue | 1);
    mixedValue ^= mixedValue + Math.imul(mixedValue ^ (mixedValue >>> 7), mixedValue | 61);
    return ((mixedValue ^ (mixedValue >>> 14)) >>> 0) / 4294967296;
  };
};
const palettes = PALETTES;

function titleLines(text) {
  const words = String(text || 'Untitled')
    .trim()
    .split(/\s+/);
  const lines = [''];
  for (const word of words) {
    const index = lines.length - 1;
    if ((lines[index] + ' ' + word).trim().length > 25 && lines[index] && lines.length < 3)
      lines.push(word);
    else lines[index] += `${lines[index] ? ' ' : ''}${word}`;
  }
  return lines.slice(0, 3).map((line) => (line.length > 35 ? `${line.slice(0, 34)}…` : line));
}

/**
 * @param {{id?:string,title?:string,subtitle?:string,seed?:string|number,paletteId?:string}} options
 * Untrusted text is XML escaped; colors come from the local palettes.
 */
export function createCoverArtwork({
  id = 'song',
  title = 'Untitled',
  subtitle = 'ENCORE ORIGINAL',
  seed,
  paletteId,
} = {}) {
  const coverSeed = hashCoverSeed(`encore-v2:${seed ?? `${id}:${title}`}`),
    nextRandomValue = createSeededRandom(coverSeed);
  const paletteIndex =
    paletteId === undefined ? coverSeed % palettes.length : coverPaletteIds.indexOf(paletteId);
  if (paletteIndex < 0) throw new Error('Unknown cover palette.');
  const [base, mid, glow, accent, ink] = palettes[paletteIndex];
  const prefix = `ag${coverSeed.toString(16)}`,
    variant = Math.floor(coverSeed / palettes.length) % 8;
  const sunX = 265 + Math.round(nextRandomValue() * 240),
    sunY = 275 + Math.round(nextRandomValue() * 100);
  const roundCoordinate = (coordinate) => Number(coordinate.toFixed(2));
  const stars = Array.from(
    { length: 35 },
    (_, index) => /* HTML */ `
      <circle
        cx="${roundCoordinate(70 + nextRandomValue() * 660)}"
        cy="${roundCoordinate(80 + nextRandomValue() * 410)}"
        r="${roundCoordinate(index % 7 === 0 ? 2 : 0.6 + nextRandomValue())}"
        fill="${ink}"
        opacity="${roundCoordinate(0.15 + nextRandomValue() * 0.4)}"
      />
    `,
  ).join('');
  const thinLines = Array.from(
    { length: 13 },
    (_, index) => /* HTML */ `
      <ellipse
        cx="400"
        cy="363"
        rx="${145 + index * 13}"
        ry="${38 + index * 12}"
        transform="rotate(-31 400 363)"
        fill="none"
        stroke="${accent}"
        stroke-width="1"
        opacity="${roundCoordinate(0.12 + (12 - index) * 0.025)}"
      />
    `,
  ).join('');
  const landscapes = /* HTML */ `
    <path d="M0 537 Q180 422 405 519 T800 486 V800 H0Z" fill="${base}" opacity=".62" />
    <path d="M0 616 Q216 467 463 573 T800 538 V800 H0Z" fill="${mid}" opacity=".45" />
    <path d="M0 679 Q220 565 431 661 T800 626 V800 H0Z" fill="${base}" opacity=".85" />
  `;
  const scenes = [
    /* HTML */ `
      <circle cx="${sunX}" cy="${sunY}" r="144" fill="url(#${prefix}-sun)" />
      <circle
        cx="${sunX - 16}"
        cy="${sunY - 23}"
        r="143"
        fill="none"
        stroke="${ink}"
        opacity=".25"
      />
      ${thinLines}${landscapes}
    `,
    /* HTML */ `
      <g transform="translate(226 132)">
        <path d="M0 454V175C0-58 348-58 348 175V454Z" fill="${mid}" />
        <path d="M31 454V177C31-16 317-16 317 177V454Z" fill="url(#${prefix}-sun)" />
        <path d="M82 454V201C82 75 266 75 266 201V454Z" fill="${base}" opacity=".7" />
        <path d="M111 454V210C111 126 237 126 237 210V454Z" fill="${glow}" opacity=".22" />
        <path d="M174 159V454" stroke="${ink}" opacity=".42" />
      </g>
      <path d="M226 586 100 800H700L574 586Z" fill="url(#${prefix}-ground)" opacity=".8" />
      <path d="M400 586V800M310 586 252 800M490 586 548 800" stroke="${ink}" opacity=".18" />
    `,
    /* HTML */ `
      <g transform="rotate(-24 400 350)">
        <ellipse cx="400" cy="350" rx="230" ry="241" fill="url(#${prefix}-sun)" />
        <ellipse cx="400" cy="350" rx="128" ry="163" fill="${base}" />
        <ellipse cx="400" cy="350" rx="179" ry="202" fill="none" stroke="${ink}" opacity=".55" />
        <ellipse
          cx="400"
          cy="350"
          rx="266"
          ry="73"
          fill="none"
          stroke="${accent}"
          stroke-width="3"
        />
        <path
          d="M162 354C254 482 548 482 641 354"
          fill="none"
          stroke="${accent}"
          stroke-width="15"
          opacity=".7"
        />
      </g>
      <path d="M0 615 800 534V800H0Z" fill="${base}" opacity=".7" />
    `,
    /* HTML */ `
      <path
        d="M191 580C85 459 186 347 302 357S549 314 461 171"
        fill="none"
        stroke="${mid}"
        stroke-width="106"
      />
      <path
        d="M220 568C126 460 219 367 322 381S580 320 476 159"
        fill="none"
        stroke="url(#${prefix}-sun)"
        stroke-width="65"
      />
      <path
        d="M240 558C166 454 234 391 338 400S596 329 490 154"
        fill="none"
        stroke="${ink}"
        stroke-width="2"
        opacity=".75"
      />
      <circle cx="574" cy="502" r="67" fill="url(#${prefix}-sun)" />
      <circle cx="574" cy="502" r="89" fill="none" stroke="${accent}" opacity=".45" />
    `,
    /* HTML */ `
      <circle cx="400" cy="344" r="193" fill="url(#${prefix}-sun)" />
      <path d="M100 610 294 246 402 454 496 309 700 610Z" fill="${base}" />
      <path d="m294 246 108 208-74-41-46 18-40-36Z" fill="${accent}" opacity=".57" />
      <path d="m496 309 87 151-54-19-26 23-44-39Z" fill="${glow}" opacity=".63" />
      <path d="M100 610H700M141 643H659M180 676H620" stroke="${ink}" opacity=".16" />
    `,
    /* HTML */ `
      <g transform="translate(400 352) rotate(35)">
        <rect
          x="-174"
          y="-174"
          width="348"
          height="348"
          rx="1"
          fill="none"
          stroke="${mid}"
          stroke-width="71"
        />
        <rect
          x="-174"
          y="-174"
          width="348"
          height="348"
          rx="1"
          fill="none"
          stroke="url(#${prefix}-sun)"
          stroke-width="34"
        />
        <rect
          x="-130"
          y="-130"
          width="260"
          height="260"
          fill="none"
          stroke="${accent}"
          opacity=".55"
        />
        <circle r="77" fill="url(#${prefix}-sun)" />
      </g>
      <path d="M129 591H670M166 605H630" stroke="${ink}" opacity=".2" />
    `,
  ];
  scenes.push(
    `<g transform="rotate(-28 400 350)">${Array.from(
      { length: 9 },
      (_, i) =>
        `<path d="M-100 ${160 + i * 42} Q240 ${-80 + i * 55} 460 ${230 + i * 34} T940 ${200 + i * 48}" fill="none" stroke="${i % 3 === 0 ? accent : i % 3 === 1 ? glow : mid}" stroke-width="${18 + i * 3}" opacity="${0.45 + i * 0.05}"/>`,
    ).join('')}</g>`,
    `<g transform="translate(400 340)">${Array.from(
      { length: 12 },
      (_, i) =>
        `<path d="M0 0 L${Math.round(Math.cos((i * Math.PI) / 6) * 260)} ${Math.round(Math.sin((i * Math.PI) / 6) * 260)} L${Math.round(Math.cos(((i + 1) * Math.PI) / 6) * 260)} ${Math.round(Math.sin(((i + 1) * Math.PI) / 6) * 260)}Z" fill="${i % 3 === 0 ? accent : i % 3 === 1 ? glow : mid}" opacity="${0.5 + (i % 4) * 0.15}"/>`,
    ).join(
      '',
    )}<circle r="68" fill="${base}"/><circle r="95" fill="none" stroke="${ink}" opacity=".5"/></g>`,
  );
  const lines = titleLines(title),
    fontSize = lines.some((l) => l.length > 24) ? 32 : 38;
  return /* HTML */ `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="800"
      height="800"
      viewBox="0 0 800 800"
      data-palette="${coverPaletteIds[paletteIndex]}"
      data-artwork-version="2"
      role="img"
      aria-labelledby="${prefix}-title ${prefix}-desc"
    >
      <title id="${prefix}-title">${escapeXml(title)} — cover art</title>
      <desc id="${prefix}-desc">
        Original abstract album artwork with luminous shapes and cinematic color.
      </desc>
      <defs>
        <linearGradient id="${prefix}-bg" x2=".8" y2="1">
          <stop stop-color="${base}" />
          <stop offset=".45" stop-color="${mid}" />
          <stop offset=".8" stop-color="${glow}" stop-opacity=".65" />
          <stop offset="1" stop-color="${base}" />
        </linearGradient>
        <linearGradient id="${prefix}-sun" x1="0" y1="1" x2=".8" y2="0">
          <stop stop-color="${mid}" />
          <stop offset=".48" stop-color="${glow}" />
          <stop offset="1" stop-color="${accent}" />
        </linearGradient>
        <linearGradient id="${prefix}-ground" x2="0" y2="1">
          <stop stop-color="${glow}" />
          <stop offset="1" stop-color="${base}" />
        </linearGradient>
        <radialGradient id="${prefix}-halo">
          <stop stop-color="${glow}" stop-opacity=".35" />
          <stop offset="1" stop-color="${glow}" stop-opacity="0" />
        </radialGradient>
        <filter id="${prefix}-grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency=".65"
            numOctaves="3"
            stitchTiles="stitch"
            seed="${coverSeed % 997}"
          />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer><feFuncA type="linear" slope=".17" /></feComponentTransfer>
          <feBlend in="SourceGraphic" mode="soft-light" />
        </filter>
      </defs>
      <rect width="800" height="800" fill="url(#${prefix}-bg)" />
      <ellipse cx="400" cy="350" rx="415" ry="420" fill="url(#${prefix}-halo)" />
      ${stars}${scenes[variant]}
      <rect
        width="800"
        height="800"
        fill="transparent"
        filter="url(#${prefix}-grain)"
        opacity=".7"
      />
      <g fill="${ink}" font-family="DM Sans, sans-serif">
        <text x="55" y="61" font-size="12" font-weight="600" letter-spacing="4">
          ENCORE / ${String(coverSeed % 100).padStart(2, '0')}
        </text>
        <path d="M715 48v17m-8-8h16" stroke="${ink}" opacity=".8" />
        <text
          x="55"
          y="${lines.length === 3 ? 630 : 664}"
          font-size="10"
          font-weight="600"
          letter-spacing="3"
          opacity=".73"
        >
          ${escapeXml(String(subtitle).toUpperCase().slice(0, 52))}
        </text>
        ${lines
          .map(
            (line, index) => /* HTML */ `
              <text
                x="53"
                y="${(lines.length === 3 ? 675 : 710) + index * 43}"
                font-size="${fontSize}"
                font-weight="400"
                letter-spacing="-1.3"
              >
                ${escapeXml(line)}
              </text>
            `,
          )
          .join('')}
      </g>
      <path d="M55 775H745" stroke="${ink}" opacity=".26" />
    </svg>
  `.trim();
}
