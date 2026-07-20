import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./poppy.css";
import "./theme.css";
import { App } from "./App";
import { definePurchaseButton } from "./purchaseButton";

// Register the standard <agentspoppy-purchase> host-drawn button once, before first render.
definePurchaseButton();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
