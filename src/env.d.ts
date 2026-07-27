/// <reference types="vite/client" />

import type { AudioVDesktopApi } from "../shared/contracts";

declare global {
  interface Window {
    audioV?: AudioVDesktopApi;
  }
}

export {};
