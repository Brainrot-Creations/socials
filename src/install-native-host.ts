#!/usr/bin/env node
/**
 * Auto-install Chrome Native Messaging Host manifest.
 *
 * Run automatically via postinstall, or manually:
 *   npx claude-plugins-install-native-host
 *
 * Writes a manifest JSON that tells Chrome where to find the coordinator script.
 * No elevated permissions needed — uses user-level directories.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const HOST_NAME = "com.brainrotcreations.socials";
const EXTENSION_ID = "jgfgohcfkpjdldjbgbdmiijklcmnplbb";

// Resolve the absolute path to the coordinator script
const coordinatorPath = path.resolve(__dirname, "native-messaging-host.cjs");

/**
 * Get the native messaging host manifest directory for the current OS and browser.
 */
function getManifestDirs(): string[] {
  const home = os.homedir();
  const platform = os.platform();

  switch (platform) {
    case "darwin":
      return [
        // Chrome
        path.join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts"),
        // Chrome Canary
        path.join(home, "Library", "Application Support", "Google", "Chrome Canary", "NativeMessagingHosts"),
        // Chromium
        path.join(home, "Library", "Application Support", "Chromium", "NativeMessagingHosts"),
        // Brave
        path.join(home, "Library", "Application Support", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"),
        // Edge
        path.join(home, "Library", "Application Support", "Microsoft Edge", "NativeMessagingHosts"),
      ];

    case "win32":
      // Windows uses registry, but also supports file-based manifests
      const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
      return [
        path.join(localAppData, "Google", "Chrome", "User Data", "NativeMessagingHosts"),
        path.join(localAppData, "BraveSoftware", "Brave-Browser", "User Data", "NativeMessagingHosts"),
        path.join(localAppData, "Microsoft", "Edge", "User Data", "NativeMessagingHosts"),
      ];

    case "linux":
      return [
        // Chrome
        path.join(home, ".config", "google-chrome", "NativeMessagingHosts"),
        // Chromium
        path.join(home, ".config", "chromium", "NativeMessagingHosts"),
        // Brave
        path.join(home, ".config", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"),
        // Edge
        path.join(home, ".config", "microsoft-edge", "NativeMessagingHosts"),
      ];

    default:
      console.error(`[NativeHost] Unsupported platform: ${platform}`);
      return [];
  }
}

/**
 * Create the native messaging host manifest.
 */
function createManifest(): object {
  return {
    name: HOST_NAME,
    description: "Socials MCP Bridge - connects Claude Code MCP servers to the Socials browser extension",
    path: coordinatorPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  };
}

/**
 * Install the native messaging host manifest.
 */
function install(): { installed: string[]; failed: string[] } {
  const manifest = createManifest();
  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestFilename = `${HOST_NAME}.json`;
  const dirs = getManifestDirs();

  const installed: string[] = [];
  const failed: string[] = [];

  for (const dir of dirs) {
    try {
      // Only install if the browser directory parent exists
      // (don't create Chrome dirs on a system that doesn't have Chrome)
      const browserDir = path.dirname(dir);
      if (!fs.existsSync(browserDir)) {
        continue; // Browser not installed, skip
      }

      // Create NativeMessagingHosts dir if needed
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const manifestPath = path.join(dir, manifestFilename);
      fs.writeFileSync(manifestPath, manifestJson, "utf8");
      installed.push(manifestPath);
    } catch (err) {
      failed.push(`${dir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Make coordinator script executable (Unix)
  if (os.platform() !== "win32") {
    try {
      fs.chmodSync(coordinatorPath, 0o755);
    } catch {
      // May not exist yet if build hasn't run
    }
  }

  return { installed, failed };
}

/**
 * Uninstall the native messaging host manifest.
 */
function uninstall(): { removed: string[] } {
  const manifestFilename = `${HOST_NAME}.json`;
  const dirs = getManifestDirs();
  const removed: string[] = [];

  for (const dir of dirs) {
    const manifestPath = path.join(dir, manifestFilename);
    try {
      if (fs.existsSync(manifestPath)) {
        fs.unlinkSync(manifestPath);
        removed.push(manifestPath);
      }
    } catch {
      // ignore
    }
  }

  return { removed };
}

// CLI entry point
const command = process.argv[2];

if (command === "uninstall" || command === "remove") {
  const { removed } = uninstall();
  if (removed.length > 0) {
    console.log(`[NativeHost] Removed ${removed.length} manifest(s):`);
    removed.forEach((p) => console.log(`  ✓ ${p}`));
  } else {
    console.log("[NativeHost] No manifests found to remove.");
  }
} else {
  // Default: install
  console.log(`[NativeHost] Installing native messaging host: ${HOST_NAME}`);
  console.log(`[NativeHost] Coordinator path: ${coordinatorPath}`);

  const { installed, failed } = install();

  if (installed.length > 0) {
    console.log(`[NativeHost] ✓ Installed ${installed.length} manifest(s):`);
    installed.forEach((p) => console.log(`  ${p}`));
  }

  if (failed.length > 0) {
    console.error(`[NativeHost] ✗ Failed ${failed.length}:`);
    failed.forEach((p) => console.error(`  ${p}`));
  }

  if (installed.length === 0 && failed.length === 0) {
    console.log("[NativeHost] No supported browsers detected. Manifest not installed.");
    console.log("[NativeHost] The WebSocket fallback will be used instead.");
  }
}
