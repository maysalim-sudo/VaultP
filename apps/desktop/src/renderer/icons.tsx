/**
 * The window's icons: one stroke family, drawn here rather than pulled from a
 * package, so there is nothing to keep in step and nothing fetched.
 */

const PATHS = {
  home: 'M4 10.5 12 4l8 6.5V20h-5v-5.5H9V20H4z',
  money: 'M3.5 7.5h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM3.5 7.5 15 4v3.5M16 13.5h1.5',
  notes: 'M6 3.5h8.5l3.5 3.5v13.5H6zM14.5 3.5V7H18M9 12h6M9 15.5h4',
  docs: 'M4 5.5h6l2 2h8v12H4zM4 10h16',
  plus: 'M12 5v14M5 12h14',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  auto: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v18',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  checklist: 'M4 6l1.5 1.5L8 5M4 13l1.5 1.5L8 12M11 6.5h9M11 13.5h9M11 19.5h9',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20a7 7 0 0 1 14 0M16 4.5a3.5 3.5 0 0 1 0 6.5M22 20a7 7 0 0 0-4-6.3',
  scan: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M4 12h16',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6',
  bank: 'M3 9 12 4l9 5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, stroke = 1.7 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
