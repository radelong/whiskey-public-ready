/* Inline single-color icons (stroke = currentColor). Keep them simple. */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...p,
});

export const CellarIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 3h8M9 3v5.2a4 4 0 0 1-.7 2.3l-.6.9a4 4 0 0 0-.7 2.3V21h8v-7.3a4 4 0 0 0-.7-2.3l-.6-.9a4 4 0 0 1-.7-2.3V3" />
    <path d="M7 15h10" />
  </svg>
);

export const BarIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 3h16l-7 8v7M13 18h4M13 18H9" />
  </svg>
);

export const GuestIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 4h10a2 2 0 0 1 2 2v3a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V6a2 2 0 0 1 2-2Z" />
    <path d="M18 6h1.5A2.5 2.5 0 0 1 22 8.5v0A2.5 2.5 0 0 1 19.5 11H18M9 17h6M12 13v4" />
  </svg>
);

export const SearchIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const SparkleIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.4 2.4M15.3 15.3l2.4 2.4M17.7 6.3l-2.4 2.4M8.7 15.3l-2.4 2.4" />
  </svg>
);

export const PlusIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const UserIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

export const UsersIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
    <path d="M16 5.2a3.2 3.2 0 0 1 0 6M17.5 20a5.5 5.5 0 0 0-3-4.9" />
  </svg>
);

export const LogoutIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h12" />
  </svg>
);

export const DollarIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

export const CheckIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 13 4 4L19 7" />
  </svg>
);

export const GlassIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 4h12l-1.5 9a3 3 0 0 1-3 2.5h-0A3 3 0 0 1 7.5 13L6 4Z" />
    <path d="M12 15.5V20M8 20h8" />
  </svg>
);

/** A stable, text-based mark for a distillery directory tile. */
export function DistilleryIcon({ name, ...p }: P & { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <svg {...base(p)} aria-hidden="true">
      <circle cx="12" cy="12" r="9.2" />
      <path d="M7.5 16.8h9" opacity=".55" />
      <text
        x="12"
        y="13.7"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        fontSize={initials.length > 1 ? "7" : "9"}
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
      >
        {initials}
      </text>
    </svg>
  );
}
