import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// No StrictMode: it double-invokes effects in dev, which would spin up a second
// render worker. The single-mount lifecycle keeps the worker simple.
//
// The service worker is registered from within the app (see lib/swUpdate.ts) so
// the same place that registers it can surface the "update available" prompt.
createRoot(document.getElementById("root")!).render(<App />);
