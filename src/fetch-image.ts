/**
 * Fetch a remote image and return base64 + MIME type for MCP image content blocks.
 * Runs in the MCP Node process (not the browser).
 */

const MAX_BYTES = 6 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 25_000

export type FetchImageResult = {
  mimeType: string
  base64: string
  byteLength: number
}

function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg"
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png"
  }
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return "image/gif"
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp"
  }
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12)
    if (brand === "avif" || brand === "avis") return "image/avif"
  }
  return null
}

/** Block obvious SSRF targets (literal hostnames / IPs only; DNS rebinding not covered). */
export function assertPublicImageUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) image URLs are allowed")
  }
  if (url.username || url.password) {
    throw new Error("URLs with credentials are not allowed")
  }

  let host = url.hostname.toLowerCase()
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1)
  }

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Localhost URLs are not allowed")
  }
  if (host.includes(":")) {
    const h = host.toLowerCase()
    if (h === "::1") throw new Error("Local IPv6 addresses are not allowed")
    if (h.startsWith("fe80:")) throw new Error("Link-local IPv6 addresses are not allowed")
    if (/^f[cd][0-9a-f]{2}:/i.test(h)) {
      throw new Error("Unique-local IPv6 addresses are not allowed")
    }
    // IPv4-mapped IPv6 (::ffff:x.x.x.x) embeds a private IPv4 — validate it
    const ipv4Mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h)
    if (ipv4Mapped) {
      assertPublicImageUrl(new URL(`http://${ipv4Mapped[1]}/`))
    }
    return
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (ipv4) {
    const a = Number(ipv4[1])
    const b = Number(ipv4[2])
    const c = Number(ipv4[3])
    const d = Number(ipv4[4])
    if ([a, b, c, d].some((n) => n > 255 || Number.isNaN(n))) {
      throw new Error("Invalid IPv4 address")
    }
    if (a === 0 || a === 10 || a === 127) {
      throw new Error("Non-public IPv4 addresses are not allowed")
    }
    if (a === 169 && b === 254) {
      throw new Error("Non-public IPv4 addresses are not allowed")
    }
    if (a === 192 && b === 168) {
      throw new Error("Non-public IPv4 addresses are not allowed")
    }
    if (a === 172 && b >= 16 && b <= 31) {
      throw new Error("Non-public IPv4 addresses are not allowed")
    }
    if (a === 100 && b >= 64 && b <= 127) {
      throw new Error("Non-public IPv4 addresses are not allowed")
    }
  }
}

export async function fetchImageFromUrl(
  urlString: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<FetchImageResult> {
  let url: URL
  try {
    url = new URL(urlString.trim())
  } catch {
    throw new Error("Invalid URL")
  }
  assertPublicImageUrl(url)

  const res = await fetch(url.toString(), {
    method: "GET",
    redirect: "error",
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "User-Agent": "Socials-MCP/1.1 (+https://socials.brainrotcreations.com)",
    },
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!res.ok) {
    throw new Error(`Failed to fetch image: HTTP ${res.status} ${res.statusText}`)
  }

  const declared = res.headers.get("content-length")
  if (declared) {
    const n = parseInt(declared, 10)
    if (Number.isFinite(n) && n > MAX_BYTES) {
      throw new Error(`Image too large (>${MAX_BYTES} bytes)`)
    }
  }

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length === 0) {
    throw new Error("Empty response body")
  }
  if (buf.length > MAX_BYTES) {
    throw new Error(`Image too large (>${MAX_BYTES} bytes)`)
  }

  const rawCt = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || ""
  let mime = rawCt.startsWith("image/") ? rawCt : ""
  if (!mime) {
    mime = sniffImageMime(buf) || ""
  }
  if (!mime.startsWith("image/")) {
    throw new Error(
      `Response is not an image (Content-Type: ${res.headers.get("content-type") || "missing"})`
    )
  }

  return {
    mimeType: mime,
    base64: buf.toString("base64"),
    byteLength: buf.length,
  }
}
