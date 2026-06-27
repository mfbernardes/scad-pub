// Icons.tsx — small inline SVG icons (no icon-font dependency). Each inherits
// the current text color via `stroke="currentColor"`.
type IconProps = { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const ResetIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v4h4" />
  </svg>
);

export const DownloadIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 3v12" />
    <path d="M7 10l5 5 5-5" />
    <path d="M5 21h14" />
  </svg>
);

export const UploadIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 21V9" />
    <path d="M7 14l5-5 5 5" />
    <path d="M5 3h14" />
  </svg>
);

export const SaveIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
    <path d="M17 21v-8H7v8" />
    <path d="M7 3v5h8" />
  </svg>
);

export const TrashIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export const InfoIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 7.5h.01" />
  </svg>
);

export const SunIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
  </svg>
);

export const MoonIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
);

export const AutoThemeIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" stroke="none" />
  </svg>
);

export const HelpIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.2 9.3a2.8 2.8 0 0 1 5.4 1c0 1.9-2.8 2.5-2.8 4" />
    <path d="M12 17.5h.01" />
  </svg>
);

export const PlayIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M7 4v16l13-8z" fill="currentColor" stroke="none" />
  </svg>
);

export const ImageIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="M21 16l-5-5L8 19" />
  </svg>
);

export const ZoomInIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
    <path d="M11 8v6M8 11h6" />
  </svg>
);

export const ZoomOutIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
    <path d="M8 11h6" />
  </svg>
);

export const LinkIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1 1" />
    <path d="M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1-1" />
  </svg>
);

export const ChevronLeftIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export const ChevronRightIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M9 18l6-6-6-6" />
  </svg>
);

export const ChevronUpIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M18 15l-6-6-6 6" />
  </svg>
);

export const ChevronDownIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const SearchIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);

export const TerminalIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 17l6-6-6-6" />
    <path d="M12 19h8" />
  </svg>
);

export const XIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const MoreIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="5" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const MaximizeIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
  </svg>
);

export const PanelLeftIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18" />
  </svg>
);

export const WifiOffIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M2 2l20 20" />
    <path d="M8.5 16.5a5 5 0 0 1 7 0" />
    <path d="M5 12.9A10 10 0 0 1 15.8 10" />
    <path d="M19 10.1A10 10 0 0 1 21 12" />
    <path d="M12 20h.01" />
  </svg>
);

export const StarIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
  </svg>
);

export const StarFilledIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path
      d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);

export const FolderIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

export const FileIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);

export const MenuIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </svg>
);

export const InstallIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 16V4" />
    <path d="M8 12l4 4 4-4" />
    <path d="M3 19h18" />
  </svg>
);
