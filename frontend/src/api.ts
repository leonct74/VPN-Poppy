// Typed wrappers over host.invokeBackend for VPN-Poppy's backend routes.

import { host } from "./host";
import type { DevicesResponse, EndpointConfig, EndpointStatus, EndpointSummary, Meta } from "./types";

export const api = {
  meta: () => host.invokeBackend<Meta>({ method: "GET", path: "/meta" }),

  listEndpoints: () => host.invokeBackend<{ endpoints: EndpointSummary[] }>({ method: "GET", path: "/endpoints" }),

  launch: (config: EndpointConfig) =>
    host.invokeBackend<{ endpoint: EndpointSummary }>({ method: "POST", path: "/endpoints/launch", body: { config } }),

  status: (id: string) =>
    host.invokeBackend<EndpointStatus>({ method: "GET", path: `/endpoints/${id}/status` }),

  teardown: (id: string) =>
    host.invokeBackend<{ ok: true }>({ method: "POST", path: `/endpoints/${id}/teardown` }),

  devices: (id: string) =>
    host.invokeBackend<DevicesResponse>({ method: "GET", path: `/endpoints/${id}/devices` }),

  renameDevice: (id: string, index: number, name: string) =>
    host.invokeBackend<{ ok: true }>({ method: "POST", path: `/endpoints/${id}/devices/${index}/rename`, body: { name } }),

  /** Hand bytes to the backend for a one-shot download token (WKWebView can't save a blob). */
  localDownloadToken: (filename: string, contentType: string, dataB64: string) =>
    host.invokeBackend<{ token: string }>({ method: "POST", path: "/local-download", body: { filename, contentType, dataB64 } }),
};
