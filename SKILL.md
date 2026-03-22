---
name: reach
description: "Agent web interface. Use when the agent needs to browse websites, fill forms, login to services, sign transactions, send emails, or interact with the web autonomously."
version: 0.1.0
author: potdealer
tags: [web, browser, automation, agent, scraping, crypto, forms]
---

# Reach — Agent Web Interface

Give any AI agent the ability to browse the web, fill forms, login to services, sign crypto transactions, send emails, watch for changes, and make payments. 9 primitives, 4 site skills, an intelligent router, and an MCP server.

## Quick Start

```javascript
import { Reach } from 'reach';

const reach = new Reach();

// Read a webpage
const page = await reach.fetch('https://example.com');
console.log(page.content);

// Click a button
await reach.act('https://example.com', 'click', { text: 'Sign Up' });

// Login to a service
await reach.authenticate('github', 'cookie');

// Sign a message
const sig = await reach.sign('hello world');

// Send an email
await reach.email('client@example.com', 'Audit Complete', 'Found 3 issues...');

// Watch for changes
const watcher = await reach.observe('https://api.example.com/price', {
  interval: 60000,
  field: 'data.price',
  threshold: 100,
  direction: 'above',
}, (event) => console.log('Price alert!', event));

// Send ETH
await reach.pay('0x1234...', '0.01', { token: 'USDC' });

// Natural language
await reach.do('search upwork for solidity jobs');

await reach.close();
```

## Primitives

| Primitive | Purpose | Example |
|-----------|---------|---------|
| `fetch(url)` | Read any webpage (HTTP or browser) | `reach.fetch('https://example.com', { format: 'json' })` |
| `act(url, action, params)` | Interact with pages (click, type, submit) | `reach.act(url, 'click', { text: 'Submit' })` |
| `authenticate(service, method)` | Login and stay logged in | `reach.authenticate('upwork', 'login', creds)` |
| `sign(payload)` | Crypto signing (message, tx, EIP-712) | `reach.sign('hello', { type: 'message' })` |
| `persist(key, value)` / `recall(key)` | State memory | `reach.persist('count', 42)` |
| `observe(target, options, cb)` | Watch for changes | `reach.observe(url, { interval: 30000 }, cb)` |
| `pay(recipient, amount, opts)` | Send ETH/ERC-20/x402 payments | `reach.pay('0x...', '0.01')` |
| `see(url)` | Screenshot + accessibility tree | `reach.see('https://example.com')` |
| `email(to, subject, body)` | Send email via Resend | `reach.email('x@y.com', 'Hi', 'Hello')` |

## Site Skills

Built-in playbooks for common platforms:

- **code4rena** — Login, browse audits, read scope, submit findings
- **upwork** — Login (with CAPTCHA solving), search jobs, submit proposals
- **github** — API-first: read repos, issues, PRs, search code
- **immunefi** — Browse bounty programs, read scope, submit reports

## Router

The router picks the best interaction layer for each task:

```
API > HTTP > Browser > Vision
```

Teach it about new sites: `reach.learnSite('https://spa.app', { needsJS: true })`

## MCP Server

Expose all primitives as MCP tools for Claude Code:

```bash
node src/mcp.js
```

Tools: `web_fetch`, `web_act`, `web_authenticate`, `web_sign`, `web_see`, `web_email`

## CLI

```bash
node src/cli.js fetch https://example.com
node src/cli.js act https://example.com click "Sign Up"
node src/cli.js do "search upwork for solidity jobs"
node src/cli.js replay
node src/cli.js webhook --port 8430 --on /github
```

## Environment Variables

```
PRIVATE_KEY=0x...           # Wallet private key for signing/payments
RPC_URL=https://...         # RPC endpoint (default: Base mainnet)
RESEND_API_KEY=re_...       # Email sending via Resend
CAPSOLVER_API_KEY=CAP-...   # CAPTCHA solving
GITHUB_TOKEN=ghp_...        # GitHub API access
UPWORK_EMAIL=...            # Upwork credentials
UPWORK_PASSWORD=...
```
