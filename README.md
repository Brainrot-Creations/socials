

# Socials MCP

**Give Claude superpowers on X, LinkedIn, and Reddit.**



---

## Install

1. Install the [Socials Chrome extension](https://chromewebstore.google.com/detail/socials-generate-posts-in/pmpemhbbmaicdmnlmenopaclpdfnllje)
2. In Claude Code:

```
/plugin marketplace add Brainrot-Creations/claude-plugins
```

```
/plugin install socials@brainrot-creations
```

```
/reload-plugins
```

Done. Talk to Claude naturally:

- *"Connect with 100 LinkedIn recruiters hiring for React roles"*
- *"Find Reddit threads about note-taking and mention my app naturally"*
- *"Reply to 50 X posts about indie hacking and promote my SaaS"*

---

## How it works

The MCP server runs locally and bridges Claude to your browser via a WebSocket connection to the Socials extension. All actions happen through your real browser session — no API keys, no rate limits.

---

## Troubleshooting

- **Port 9847 in use** — Kill stale node processes or set `SOCIALS_MCP_RECLAIM_PORT=1`
- **Extension not connecting** — Open the Socials side panel, then reload
- **Tools not working** — Make sure you're signed into Socials

---

## Development

```bash
npm install
npm run build       # build dist/
npm run typecheck   # type check
npm run release:dry # preview a release without publishing
```

### Use local MCP in plugin dev mode

1. Build local MCP:

```bash
cd socials/mcp
npm run build
```

1. Set dev mode in `claude-plugins/plugins/socials/.mcp.json`:

```json
{
  "mcpServers": {
    "socials": {
      "env": {
        "SOCIALS_MCP_DEV_MODE": "1",
        "SOCIALS_MCP_DEV_MCP_PATH": "/absolute/path/to/socials/mcp/dist/index.cjs"
      }
    }
  }
}
```

1. Restart Claude Code.

To switch back to published npm package, set `"SOCIALS_MCP_DEV_MODE": "0"` and restart.

Releases are automated via CI — commit to `main` with `[release:patch]`, `[release:minor]`, or `[release:major]` in the message to publish.

---

[MIT License](./LICENSE) · [Security](./SECURITY.md) · [contact@brainrotcreations.com](mailto:contact@brainrotcreations.com)