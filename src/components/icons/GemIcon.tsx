/**
 * GemIcon — faceted gemstone silhouette tinted by `color`.
 * Replaces the plain colored circle used in GemPouch/GemBadge so each
 * gemstone reads as a cut gem while the hue still encodes its type.
 */
interface GemIconProps {
  color: string;
  size?: number;
  className?: string;
  title?: string;
}

export function GemIcon({ color, size = 12, className, title }: GemIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {/* Outer faceted gem shape */}
      <polygon
        points="12,2 21,9 16,22 8,22 3,9"
        fill={color}
        stroke="hsl(0 0% 0% / 0.55)"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* Top crown facets */}
      <polygon points="12,2 21,9 16,9" fill="hsl(0 0% 100% / 0.35)" />
      <polygon points="12,2 16,9 8,9" fill="hsl(0 0% 100% / 0.18)" />
      <polygon points="12,2 8,9 3,9" fill="hsl(0 0% 0% / 0.18)" />
      {/* Pavilion separator */}
      <polyline
        points="3,9 8,9 12,2 16,9 21,9"
        fill="none"
        stroke="hsl(0 0% 0% / 0.35)"
        strokeWidth="0.75"
        strokeLinejoin="round"
      />
      {/* Bottom shadow facet */}
      <polygon points="8,22 16,22 12,14" fill="hsl(0 0% 0% / 0.22)" />
      {/* Specular highlight */}
      <polygon points="10,3.5 13,3 11,8" fill="hsl(0 0% 100% / 0.55)" />
    </svg>
  );
}
