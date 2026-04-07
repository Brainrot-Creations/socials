<p align="center">
  <img src="./assets/socials.gif" alt="Socials" width="100%" />
</p>

<h1 align="center">Socials MCP</h1>

<p align="center">
  <strong>Give Claude superpowers on X, LinkedIn, and Reddit.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@brainrotcreations/socials"><img src="https://img.shields.io/npm/v/@brainrotcreations/socials?label=%40brainrotcreations%2Fsocials" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/socials"><img src="https://img.shields.io/npm/v/socials?label=socials" alt="npm unscoped" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
</p>

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

- _"Connect with 100 LinkedIn recruiters hiring for React roles"_
- _"Find Reddit threads about note-taking and mention my app naturally"_
- _"Reply to 50 X posts about indie hacking and promote my SaaS"_

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

Releases are automated via CI — commit to `main` with `[release:patch]`, `[release:minor]`, or `[release:major]` in the message to publish.

---

[MIT License](./LICENSE) · [Security](./SECURITY.md) · [contact@brainrotcreations.com](mailto:contact@brainrotcreations.com)
