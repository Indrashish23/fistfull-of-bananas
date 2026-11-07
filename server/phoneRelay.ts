/// <reference types="node" />
// For development: lets a phone on the same Wi-Fi reach the game running on this computer.
// Browsers only open a phone's microphone on https, so the phone page gets its own https port,
// with a self-signed certificate. Each phone POSTs its readings here, and they're passed on to
// the TV over a WebSocket. Nothing leaves the local network.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { generate } from "selfsigned";
import type { Plugin } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { RelayRooms, isRoomCode } from "./relayRooms";

const PHONE_PORT = 7143;
const MAX_MESSAGE_BYTES = 2048;
const CERT_DIR = ".certs";

/** This computer's address on the home network. */
function lanAddress(): string | null {
  const found: string[] = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const a of addresses ?? []) {
      if (a.family === "IPv4" && !a.internal) found.push(a.address);
    }
  }
  return (
    found.find((a) => a.startsWith("192.168.")) ??
    found.find((a) => a.startsWith("10.")) ??
    found[0] ??
    null
  );
}

/** One certificate per address, kept so a phone only has to accept it once. */
async function certificateFor(address: string): Promise<{ key: string; cert: string }> {
  const keyPath = join(CERT_DIR, `${address}.key`);
  const certPath = join(CERT_DIR, `${address}.crt`);
  if (existsSync(keyPath) && existsSync(certPath)) {
    return { key: readFileSync(keyPath, "utf8"), cert: readFileSync(certPath, "utf8") };
  }
  const made = await generate([{ name: "commonName", value: address }], {
    keySize: 2048,
    algorithm: "sha256",
    extensions: [{ name: "subjectAltName", altNames: [{ type: 7, ip: address }] }],
  });
  mkdirSync(CERT_DIR, { recursive: true });
  writeFileSync(keyPath, made.private);
  writeFileSync(certPath, made.cert);
  return { key: made.private, cert: made.cert };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_MESSAGE_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

export function phoneRelay(): Plugin {
  return {
    name: "ragebait-phone-relay",
    apply: "serve",
    async configureServer(server) {
      const rooms = new RelayRooms();
      const address = lanAddress();

      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://local");
        if (url.pathname === "/phone-relay/info") {
          json(res, 200, { url: address ? `https://${address}:${PHONE_PORT}/phone.html` : null });
          return;
        }
        if (url.pathname === "/phone-relay/send" && req.method === "POST") {
          const room = url.searchParams.get("room");
          if (!isRoomCode(room)) {
            json(res, 400, { error: "bad room" });
            return;
          }
          void readBody(req).then((body) => {
            if (body === null) {
              json(res, 413, { error: "too large" });
              return;
            }
            json(res, 200, { tv: rooms.forward(room, body) });
          });
          return;
        }
        next();
      });

      // Only this path is ours. Vite's own hot-reload socket shares the same server.
      const sockets = new WebSocketServer({ noServer: true });
      server.httpServer?.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url ?? "/", "http://local");
        if (url.pathname !== "/phone-relay/tv") return;
        const room = url.searchParams.get("room");
        if (!isRoomCode(room)) {
          socket.destroy();
          return;
        }
        sockets.handleUpgrade(req, socket, head, (ws) => {
          const leave = rooms.join(room, {
            send: (data) => ws.send(data),
            isOpen: () => ws.readyState === WebSocket.OPEN,
          });
          ws.on("close", leave);
          ws.on("error", leave);
        });
      });

      if (!address) {
        server.config.logger.warn("[phone] No network address found, so phones can't connect.");
        return;
      }
      const secure = createHttpsServer(await certificateFor(address), server.middlewares);
      secure.on("error", (error: Error) => {
        server.config.logger.warn(`[phone] Couldn't open the phone port: ${error.message}`);
      });
      secure.listen(PHONE_PORT, "0.0.0.0", () => {
        server.config.logger.info(`[phone] Phone page: https://${address}:${PHONE_PORT}/phone.html`);
      });
      server.httpServer?.on("close", () => {
        secure.close();
        sockets.close();
      });
    },
  };
}
