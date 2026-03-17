import { useEffect } from "react";

const DESIGN_WIDTH = 1920;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.0;

export function useViewportZoom() {
  useEffect(() => {
    const apply = () => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, window.innerWidth / DESIGN_WIDTH));
      (document.documentElement.style as any).zoom = zoom.toString();
    };

    apply();
    window.addEventListener("resize", apply);

    return () => {
      window.removeEventListener("resize", apply);
      (document.documentElement.style as any).zoom = "1";
    };
  }, []);
}
