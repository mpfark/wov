import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, X } from "lucide-react";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DISMISS_KEY = "wov:update-dismissed-build";

/**
 * Polls the server for a newer build by comparing the main script tag in `/`
 * (Vite emits hashed asset filenames like `/assets/index-ABC123.js`, so any
 * change in that filename means a new deploy is available).
 *
 * No service worker required — works for both browser tabs and the
 * "Add to Home Screen" PWA install.
 */
function getCurrentBuildId(): string | null {
  // Look for the main module script that Vite injected on first load.
  const scripts = Array.from(document.querySelectorAll("script[type=module][src]")) as HTMLScriptElement[];
  const main = scripts.find((s) => /\/assets\/index-[^/]+\.js$/.test(s.src) || /\/src\/main\.tsx/.test(s.src));
  return main ? main.src : null;
}

async function fetchLatestBuildId(): Promise<string | null> {
  try {
    const res = await fetch("/", { cache: "no-store", headers: { "cache-control": "no-cache" } });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i);
    if (!match) return null;
    return new URL(match[1], window.location.origin).href;
  } catch {
    return null;
  }
}

export function UpdateAvailableBanner() {
  const [latestBuild, setLatestBuild] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const current = getCurrentBuildId();
    if (!current) return; // Dev mode — nothing to compare

    let cancelled = false;

    const check = async () => {
      const latest = await fetchLatestBuildId();
      if (cancelled || !latest) return;
      if (latest !== current) {
        const dismissedFor = sessionStorage.getItem(DISMISS_KEY);
        if (dismissedFor === latest) return; // user dismissed this exact build
        setLatestBuild(latest);
      }
    };

    // Initial check shortly after load, then on a slow interval and on focus.
    const initialTimer = setTimeout(check, 15_000);
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (!latestBuild || dismissed) return null;

  const handleReload = () => {
    // Hard reload to pick up the new bundle.
    window.location.reload();
  };

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, latestBuild);
    setDismissed(true);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-[9998] -translate-x-1/2 w-[calc(100%-2rem)] max-w-md
                 rounded-lg border border-primary/40 bg-card/95 backdrop-blur shadow-lg
                 px-4 py-3 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4"
    >
      <RefreshCw className="h-5 w-5 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-display text-sm text-primary leading-tight">A new version is available</p>
        <p className="text-xs text-muted-foreground mt-0.5">Refresh to load the latest update.</p>
      </div>
      <Button size="sm" onClick={handleReload} className="font-display">
        Refresh
      </Button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss update notice"
        className="text-muted-foreground hover:text-foreground transition-colors p-1"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
