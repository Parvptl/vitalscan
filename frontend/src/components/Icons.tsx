/** Inline SVG icons. Decorative by default; pass a `title` to expose a label. */

interface IconProps {
  size?: number;
  title?: string;
  className?: string;
}

function svgProps({ size = 20, title, className }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    role: title ? ('img' as const) : undefined,
    'aria-hidden': title ? undefined : true,
    'aria-label': title,
  };
}

export function HeartIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 20.5 4.2 12.9a4.8 4.8 0 0 1 0-6.8 4.8 4.8 0 0 1 6.8 0l1 1 1-1a4.8 4.8 0 0 1 6.8 0 4.8 4.8 0 0 1 0 6.8Z" />
    </svg>
  );
}

export function PulseIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M2 12h4l2.5-7 4 14L15 12h7" />
    </svg>
  );
}

export function LungsIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 3v9" />
      <path d="M9 11c0 4-1.5 6.5-3.5 8-1.3 1-2.5.3-2.5-1.2V13c0-2.6 1.7-4.6 3.8-5.3C8.2 7.3 9 8 9 9.1Z" />
      <path d="M15 11c0 4 1.5 6.5 3.5 8 1.3 1 2.5.3 2.5-1.2V13c0-2.6-1.7-4.6-3.8-5.3C15.8 7.3 15 8 15 9.1Z" />
    </svg>
  );
}

export function DropletIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 3s6 6.2 6 10a6 6 0 0 1-12 0c0-3.8 6-10 6-10Z" />
    </svg>
  );
}

export function WaveIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M2 14c2.5 0 2.5-4 5-4s2.5 4 5 4 2.5-4 5-4 2.5 4 5 4" />
    </svg>
  );
}

export function GaugeIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="m12 14 4-4" />
      <circle cx="12" cy="14" r="1.4" />
    </svg>
  );
}

export function FlashIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12Z" />
    </svg>
  );
}

export function FlashOffIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M13 2 8.4 8.2M11 13.5H4.5L8 8.8M10 22l3.6-4.9m1.6-2.2L18.5 10.5H12l.6-2.4" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function FingerIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M9 11V5.5a1.8 1.8 0 0 1 3.6 0V11" />
      <path d="M12.6 11V9.2a1.7 1.7 0 0 1 3.4 0V13" />
      <path d="M16 12.4a1.7 1.7 0 0 1 3.4 0V16a6 6 0 0 1-6 6h-1.6a5 5 0 0 1-3.6-1.6L5 16.6a1.8 1.8 0 0 1 2.6-2.4L9 15.5V11" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 3 5 6v5.5c0 4.3 2.9 8.2 7 9.5 4.1-1.3 7-5.2 7-9.5V6Z" />
      <path d="m9.2 12 2 2 3.6-3.8" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)} strokeWidth={2.4}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M5 12h14m-5.5-5.5L19 12l-5.5 5.5" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 8.5v4.5m0 3.2v.1" />
      <path d="M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}
