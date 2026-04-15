import { useState, useEffect, useRef, useCallback } from 'react';

interface WithIllustration {
  illustration_url?: string;
  connections?: Array<{ node_id: string }>;
}

interface LocationBackgroundProps {
  node?: WithIllustration | null;
  area?: WithIllustration | null;
  region?: WithIllustration | null;
  allNodes?: WithIllustration[];
}

export default function LocationBackground({ node, area, region }: LocationBackgroundProps) {
  const resolvedUrl = node?.illustration_url || area?.illustration_url || region?.illustration_url || '';
  const [loadedUrl, setLoadedUrl] = useState('');
  const [visible, setVisible] = useState(false);
  const prevUrlRef = useRef('');

  // Preload image, then fade in
  useEffect(() => {
    if (!resolvedUrl) {
      setVisible(false);
      prevUrlRef.current = '';
      const t = setTimeout(() => setLoadedUrl(''), 300);
      return () => clearTimeout(t);
    }

    if (resolvedUrl === prevUrlRef.current) return;
    prevUrlRef.current = resolvedUrl;

    // Fade out, load new, fade in
    setVisible(false);
    const img = new Image();
    img.src = resolvedUrl;
    img.onload = () => {
      setLoadedUrl(resolvedUrl);
      requestAnimationFrame(() => setVisible(true));
    };
    img.onerror = () => {
      setLoadedUrl('');
      setVisible(false);
    };
  }, [resolvedUrl]);

  // Preload adjacent node illustrations
  const preloadAdjacent = useCallback(() => {
    if (!node?.connections) return;
    // This could be extended to look up adjacent node illustration_urls
    // For now, the browser cache handles repeated visits
  }, [node?.connections]);

  useEffect(() => {
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(preloadAdjacent);
      return () => cancelIdleCallback(id);
    } else {
      const t = setTimeout(preloadAdjacent, 200);
      return () => clearTimeout(t);
    }
  }, [preloadAdjacent]);

  if (!loadedUrl && !resolvedUrl) return null;

  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
      {loadedUrl && (
        <img
          src={loadedUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
          style={{ opacity: visible ? 1 : 0 }}
          loading="lazy"
        />
      )}
      {/* Dark gradient overlay for text readability */}
      <div
        className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-black/60 transition-opacity duration-300"
        style={{ opacity: visible ? 1 : 0 }}
      />
    </div>
  );
}
