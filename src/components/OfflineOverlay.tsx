import { useEffect, useState } from "react";

export function OfflineOverlay() {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="text-center space-y-4 px-6 max-w-sm">
        <p className="text-4xl">🌑</p>
        <h2 className="font-display text-xl text-primary text-glow">
          The Realm is Unreachable
        </h2>
        <p className="text-sm text-muted-foreground">
          Wayfarers of Varneth requires an internet connection. The overlay will The overlay will
          disappear once you're back online.
        </p>
      </div>
    </div>
  );
}
