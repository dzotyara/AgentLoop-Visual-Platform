import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";

// Follow the API server's PORT from .env so moving the API off a busy port needs one setting, not two.
const fileEnv = loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), "");
const apiPort = process.env.PORT ?? fileEnv.PORT ?? "8790";
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? fileEnv.VITE_API_PROXY_TARGET ?? `http://127.0.0.1:${apiPort}`;
const wsTarget = process.env.VITE_WS_PROXY_TARGET ?? apiTarget.replace(/^http/i, "ws");

type ProxyErrorResponse = ServerResponse<IncomingMessage> | Socket;
type ProxyLike = {
  on(
    event: "error",
    listener: (err: NodeJS.ErrnoException, req: IncomingMessage, res: ProxyErrorResponse) => void,
  ): void;
  on(event: "proxyReqWs", listener: (proxyReq: unknown, req: IncomingMessage, socket: Socket) => void): void;
};

const isServerResponse = (res: ProxyErrorResponse): res is ServerResponse<IncomingMessage> => {
  return typeof (res as ServerResponse<IncomingMessage>).writeHead === "function";
};

const silenceEpipe = (proxy: ProxyLike) => {
  proxy.on("error", (err: NodeJS.ErrnoException, _req, res) => {
    if (err.code === "EPIPE" || err.code === "ECONNRESET") return;
    if (res && isServerResponse(res) && !res.headersSent) {
      res.writeHead(502);
      res.end();
    }
  });
  proxy.on("proxyReqWs", (_proxyReq, _req, socket) => {
    socket.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EPIPE" || err.code === "ECONNRESET") return;
    });
  });
};

const manualChunks = (id: string): string | undefined => {
  if (!id.includes("node_modules")) return undefined;
  if (id.includes("/node_modules/@pixi/")) {
    const match = id.match(/\/node_modules\/(@pixi\/[^/]+)\//);
    if (match) return `vendor-${match[1].replace("@pixi/", "pixi-")}`;
  }
  if (id.includes("/node_modules/pixi.js/")) return "vendor-pixi";
  if (id.includes("/node_modules/pptxgenjs/")) return "vendor-pptx";
  if (id.includes("/node_modules/react-router-dom/") || id.includes("/node_modules/react-router/"))
    return "vendor-router";
  if (
    id.includes("/node_modules/react-dom/") ||
    id.includes("/node_modules/react/") ||
    id.includes("/node_modules/scheduler/")
  )
    return "vendor-react";
  return undefined;
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: [".ts.net"],
    watch: {
      ignored: ["**/.climpire-worktrees/**"],
    },
    proxy: {
      "/api": {
        target: apiTarget,
        configure: silenceEpipe,
      },
      "/ws": {
        target: wsTarget,
        ws: true,
        configure: silenceEpipe,
      },
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 550,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
});
