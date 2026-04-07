#!/usr/bin/env node
/**
 * Native Messaging Host (Coordinator)
 *
 * Launched by Chrome when the extension calls chrome.runtime.connectNative().
 * Acts as a relay between the Chrome extension (via stdio) and MCP servers (via WebSocket).
 *
 * Architecture:
 *   Chrome Extension ←──stdio──→ Coordinator ←──WebSocket──→ MCP Server(s)
 *
 * Protocol (stdio - Chrome Native Messaging):
 *   Each message: 4-byte little-endian uint32 length + JSON body
 *
 * Protocol (WebSocket - MCP servers):
 *   JSON messages with { type, mcpId, message } envelope
 */

import { WebSocketServer, WebSocket } from "ws";

// Coordinator port — outside the standalone MCP range (9847-9856)
// Can be overridden via SOCIALS_COORDINATOR_PORT env var (set by PostHog config)
const COORDINATOR_PORT = parseInt(process.env.SOCIALS_COORDINATOR_PORT || "9846", 10);
const COORDINATOR_HOST = "127.0.0.1";

// ============ Native Messaging Protocol (stdio) ============

/**
 * Read a native messaging message from stdin.
 * Format: 4-byte LE uint32 length prefix + JSON body
 */
function readNativeMessage(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Read 4-byte length prefix
    const lengthBuf = Buffer.alloc(4);
    let bytesRead = 0;

    const readLength = () => {
      const chunk = process.stdin.read(4 - bytesRead);
      if (!chunk) {
        process.stdin.once("readable", readLength);
        return;
      }
      chunk.copy(lengthBuf, bytesRead);
      bytesRead += chunk.length;
      if (bytesRead < 4) {
        process.stdin.once("readable", readLength);
        return;
      }

      const messageLength = lengthBuf.readUInt32LE(0);
      if (messageLength === 0) {
        resolve(null);
        return;
      }
      if (messageLength > 1024 * 1024) {
        reject(new Error(`Message too large: ${messageLength} bytes`));
        return;
      }

      // Read message body
      let body = "";
      let bodyBytesRead = 0;
      const readBody = () => {
        const bodyChunk = process.stdin.read(messageLength - bodyBytesRead);
        if (!bodyChunk) {
          process.stdin.once("readable", readBody);
          return;
        }
        body += bodyChunk.toString("utf8");
        bodyBytesRead += bodyChunk.length;
        if (bodyBytesRead < messageLength) {
          process.stdin.once("readable", readBody);
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Invalid JSON: ${body.slice(0, 200)}`));
        }
      };
      readBody();
    };
    readLength();
  });
}

/**
 * Write a native messaging message to stdout.
 * Format: 4-byte LE uint32 length prefix + JSON body
 */
function writeNativeMessage(message: unknown): void {
  const json = JSON.stringify(message);
  const buf = Buffer.from(json, "utf8");
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32LE(buf.length, 0);
  process.stdout.write(lengthBuf);
  process.stdout.write(buf);
}

// ============ MCP Server Management ============

interface McpConnection {
  ws: WebSocket;
  mcpId: string;
  registeredAt: number;
}

const mcpConnections = new Map<string, McpConnection>();

// ============ WebSocket Server for MCP Servers ============

const wss = new WebSocketServer({ port: COORDINATOR_PORT, host: COORDINATOR_HOST });

wss.on("listening", () => {
  // Notify extension that coordinator is ready
  writeNativeMessage({
    type: "coordinator_ready",
    port: COORDINATOR_PORT,
    timestamp: Date.now(),
  });
});

wss.on("connection", (ws: WebSocket) => {
  let mcpId: string | null = null;

  ws.on("message", (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString("utf8"));

      // Registration message from MCP server
      if (msg.type === "register") {
        mcpId = msg.mcpId || `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        mcpConnections.set(mcpId, { ws, mcpId, registeredAt: Date.now() });

        // Acknowledge registration
        ws.send(JSON.stringify({ type: "registered", mcpId }));

        // Notify extension about new MCP server
        writeNativeMessage({
          type: "mcp_connected",
          mcpId,
          timestamp: Date.now(),
          totalConnections: mcpConnections.size,
        });
        return;
      }

      // Regular message from MCP → forward to extension
      if (mcpId) {
        writeNativeMessage({
          type: "from_mcp",
          mcpId,
          message: msg,
        });
      }
    } catch (e) {
      // Ignore malformed messages
    }
  });

  ws.on("close", () => {
    if (mcpId) {
      mcpConnections.delete(mcpId);
      // Notify extension about MCP disconnection
      writeNativeMessage({
        type: "mcp_disconnected",
        mcpId,
        timestamp: Date.now(),
        totalConnections: mcpConnections.size,
      });
    }
  });

  ws.on("error", () => {
    // Connection error, will be cleaned up in close handler
  });
});

wss.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    // Port is already in use - another coordinator is running
    writeNativeMessage({
      type: "coordinator_error",
      error: `Port ${COORDINATOR_PORT} already in use. Another coordinator may be running.`,
      code: "EADDRINUSE",
    });
    process.exit(1);
  }
  writeNativeMessage({
    type: "coordinator_error",
    error: err.message,
  });
});

// ============ Read messages from extension (via stdin) ============

async function readLoop(): Promise<void> {
  while (true) {
    try {
      const msg = (await readNativeMessage()) as {
        type: string;
        mcpId?: string;
        message?: unknown;
      } | null;
      if (!msg) continue;

      switch (msg.type) {
        case "to_mcp": {
          // Route message from extension to a specific MCP server
          if (msg.mcpId && msg.message) {
            const conn = mcpConnections.get(msg.mcpId);
            if (conn && conn.ws.readyState === WebSocket.OPEN) {
              conn.ws.send(JSON.stringify(msg.message));
            } else {
              writeNativeMessage({
                type: "error",
                mcpId: msg.mcpId,
                error: "MCP server not connected",
              });
            }
          }
          break;
        }

        case "broadcast": {
          // Send message to all connected MCP servers
          if (msg.message) {
            const json = JSON.stringify(msg.message);
            for (const conn of mcpConnections.values()) {
              if (conn.ws.readyState === WebSocket.OPEN) {
                conn.ws.send(json);
              }
            }
          }
          break;
        }

        case "list_connections": {
          // Return list of connected MCP servers
          const connections = Array.from(mcpConnections.entries()).map(
            ([id, conn]) => ({
              mcpId: id,
              registeredAt: conn.registeredAt,
              readyState: conn.ws.readyState,
            })
          );
          writeNativeMessage({
            type: "connections_list",
            connections,
            totalConnections: connections.length,
          });
          break;
        }

        case "ping": {
          writeNativeMessage({ type: "pong", timestamp: Date.now() });
          break;
        }

        default:
          break;
      }
    } catch (err) {
      // stdin closed or read error - extension disconnected
      break;
    }
  }

  // Extension disconnected - shut down
  cleanup();
}

function cleanup(): void {
  // Close all MCP connections
  for (const conn of mcpConnections.values()) {
    try {
      conn.ws.close();
    } catch {
      // ignore
    }
  }
  mcpConnections.clear();

  // Close WebSocket server
  wss.close();
  process.exit(0);
}

// Handle process signals
process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);

// stdin closing means Chrome killed us
process.stdin.on("end", cleanup);

// Start reading from extension
readLoop();
