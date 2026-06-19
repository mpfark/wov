import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Clean up any stale service workers from the old PWA setup
navigator.serviceWorker?.getRegistrations().then(regs =>
  regs.forEach(r => r.unregister())
);

// Silence chatty dev-time logs in production builds so end users don't see
// internal state in the browser console. We keep `warn` and `error` so real
// problems (and our ErrorBoundary logs) still surface for debugging.
if (import.meta.env.PROD) {
  const noop = () => {};
  // eslint-disable-next-line no-console
  console.log = noop;
  // eslint-disable-next-line no-console
  console.info = noop;
  // eslint-disable-next-line no-console
  console.debug = noop;
}

createRoot(document.getElementById("root")!).render(<App />);
