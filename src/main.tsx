import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Clean up any stale service workers from the old PWA setup
navigator.serviceWorker?.getRegistrations().then(regs =>
  regs.forEach(r => r.unregister())
);

createRoot(document.getElementById("root")!).render(<App />);
