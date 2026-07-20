/// <reference types="vite/client" />

import type { DetailedHTMLProps, HTMLAttributes } from "react";

// The host-drawn standard purchase element (defined in purchaseButton.ts).
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "agentspoppy-purchase": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        product: string;
        target?: string;
        label?: string;
      };
    }
  }
}
