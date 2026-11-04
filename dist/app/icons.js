const iconPaths = {
  spark: 'M12 2v20M2 12h20M5 5l14 14M5 19 19 5',
  home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  plus: 'M12 5v14M5 12h14',
  library: 'M4 4v16M9 4v16M14 4v16m4-15 3 14',
  heart:
    'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  menu: 'M3 6h18M3 12h18M3 18h18',
  search: 'm21 21-5-5M19 10a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  'chevron-up': 'm6 15 6-6 6 6',
  'chevron-down': 'm6 9 6 6 6-6',
  play: 'm8 5 11 7-11 7Z',
  pause: 'M8 5v14M16 5v14',
  next: 'm5 5 10 7-10 7ZM19 5v14',
  prev: 'm19 5-10 7 10 7ZM5 5v14',
  shuffle: 'M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 4-3 6-6m2-4c1-1 2-2 4-2h3m-4-4 4 4-4 4',
  repeat: 'm17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3',
  volume: 'm11 4-6 5H2v6h3l6 5Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
  lyrics: 'M4 5h16M4 10h16M4 15h10M4 20h7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'm6 6 12 12M6 18 18 6',
  link: 'M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  image: 'M3 3h18v18H3Zm0 14 6-6 4 4 3-3 5 5M7 7h.01',
  check: 'm5 12 4 4L20 5',
  settings:
    'M9 2h6l.5 3 1.5.9 2.8-1 3 5-2.3 2v.2l2.3 2-3 5-2.8-1-1.5.9L15 22H9l-.5-3-1.5-.9-2.8 1-3-5 2.3-2v-.2l-2.3-2 3-5 2.8 1 1.5-.9ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  note: 'M9 18V5l12-2v13M9 8l12-2M9 18a3 3 0 1 1-3-3c2 0 3 1 3 3Zm12-2a3 3 0 1 1-3-3c2 0 3 1 3 3Z',
  copy: 'M8 8h13v13H8ZM4 16H2V2h14v2',
  edit: 'm16 3 5 5L8 21H3v-5ZM13 6l5 5',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
};
export const renderIcon = (name, className = '') => /* HTML */ `
  <svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="true">
    <path d="${iconPaths[name] || iconPaths.note}" />
  </svg>
`;
