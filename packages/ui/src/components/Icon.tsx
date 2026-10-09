// Simple stroke icons drawn for Trailmark (24×24 grid, currentColor).
const PATHS = {
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  back: 'M15 6l-6 6 6 6',
  library: 'M5 4v16M10 4v16M15 5l4 15',
  trail: 'M5 19c3-6 8-4 10-9s-1-6 4-6M5 19h.01M19 4h.01',
  record: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  stack: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  label,
}: {
  name: IconName;
  size?: number;
  label?: string;
}) {
  return (
    <svg
      class="tm-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
