import { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { toast } from "@/hooks/use-toast";

export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    if (needRefresh) {
      toast({
        title: "⚔️ Update Available",
        description: "A new version of Wayfarers of Varneth is ready.",
        action: (
          <button
            onClick={() => updateServiceWorker(true)}
            className="rounded bg-primary px-3 py-1 text-xs font-bold text-primary-foreground"
          >
            Refresh
          </button>
        ),
        duration: Infinity,
      });
    }
  }, [needRefresh, updateServiceWorker]);

  return null;
}
