import { spaceQueryClient } from "@hatch/space-sdk/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";

const rootEl = document.querySelector<HTMLElement>("[data-generated-space-root]");
if (!rootEl) {
  throw new Error("missing generated space root element");
}

// Standalone edition: the page scrolls the document natively (the App's
// scroll helpers fall back to window scrolling when there is no inner
// scroll container), which is the correct behaviour on Windows, macOS,
// iOS and Android browsers. Safe-area padding is applied in CSS.
createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={spaceQueryClient}>
      <div className="hatch-space-root">
        <App />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
