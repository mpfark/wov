import { useState } from 'react';

interface Props {
  url?: string | null;
  alt: string;
  size?: number;
  className?: string;
}

/**
 * Square framed illustration for an item, shown above tooltips.
 * Renders nothing if url is empty/missing or fails to load.
 */
export default function ItemIllustration({ url, alt, size = 96, className = '' }: Props) {
  const [errored, setErrored] = useState(false);
  if (!url || errored) return null;
  return (
    <div
      className={`mx-auto mb-1.5 rounded border border-border/60 bg-background/40 overflow-hidden ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src={url}
        alt={alt}
        loading="lazy"
        onError={() => setErrored(true)}
        className="w-full h-full object-cover"
      />
    </div>
  );
}
