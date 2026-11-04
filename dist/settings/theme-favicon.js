export function updateBrowserTheme(palette, page = document) {
  const icon = page.querySelector('link[rel="icon"]');
  if (icon) {
    const background = palette.fill;
    const foreground = '#fff';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="${background}"/><g stroke="${foreground}" stroke-width="5" stroke-linecap="round"><path d="M32 13v38M13 32h38M19 19l26 26M19 45l26-26"/></g></svg>`;
    icon.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
  const browserColor = page.querySelector('meta[name="theme-color"]');
  if (browserColor) browserColor.content = '#000000';
}
