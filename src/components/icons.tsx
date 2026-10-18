import type { CSSProperties } from "react";
export function Icon({
  name,
  size = 22,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  const paths: Record<string, React.ReactNode> = {
    document: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M8 13h8M8 17h5" />
      </>
    ),
    "pdf-images": (
      <>
        <path d="M13 3H5a2 2 0 0 0-2 2v11M13 3v5h5M13 3l5 5" />
        <rect x="8" y="11" width="13" height="10" rx="2" />
        <path d="m9 19 4-4 3 3 2-2 3 3" />
        <path d="M17 14h.01" />
      </>
    ),
    "images-pdf": (
      <>
        <rect x="3" y="3" width="12" height="12" rx="2" />
        <path d="m4 12 4-4 4 4M10 18v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10a1 1 0 0 0-1-1h-2M15 14v4m-2-2 2 2 2-2" />
      </>
    ),
    "image-converter": (
      <>
        <path d="M4 8h15m-3-3 3 3-3 3M20 16H5m3-3-3 3 3 3" />
      </>
    ),
    merge: (
      <>
        <path d="M5 3v4c0 4 7 3 7 7m7-11v4c0 4-7 3-7 7v7m-4-4 4 4 4-4" />
      </>
    ),
    extract: (
      <>
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="m8.2 8.2 12 12M8.2 15.8 20 4M14 12l-2 2" />
      </>
    ),
    rotate: (
      <>
        <path d="M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6" />
        <rect x="10" y="8" width="6" height="9" rx="1" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z" />
        <path d="m8.5 12 2.5 2.5 4.5-5" />
      </>
    ),
    arrow: (
      <>
        <path d="M4 12h15m-5-5 5 5-5 5" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    up: <path d="m6 15 6-6 6 6" />,
    down: <path d="m6 9 6 6 6-6" />,
    check: <path d="m5 12 4 4L19 6" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6m0-10h.01" />
      </>
    ),
    bolt: <path d="m13 2-9 12h7l-1 8 10-12h-7z" />,
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
      </>
    ),
    device: (
      <>
        <rect x="6" y="2" width="12" height="20" rx="3" />
        <path d="M11 18h2" />
      </>
    ),
    external: (
      <>
        <path d="M14 3h7v7M10 14 21 3M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {paths[name] || paths.document}
    </svg>
  );
}
