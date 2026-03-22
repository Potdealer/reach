#!/usr/bin/env node

import dotenv from 'dotenv';
dotenv.config();

import { Reach } from './index.js';
import { loadRecording, listRecordings, formatTimeline } from './utils/recorder.js';
import { parseCommand, executeCommand } from './natural.js';
import { listForms } from './utils/form-memory.js';
import { WebhookServer } from './utils/webhook-server.js';

const reach = new Reach();
const [,, command, ...args] = process.argv;

async function main() {
  if (!command) {
    printHelp();
    process.exit(0);
  }

  try {
    switch (command) {
      case 'fetch': {
        const url = args[0];
        if (!url) { console.error('Usage: reach fetch <url> [--format markdown|html|json|screenshot] [--js]'); process.exit(1); }
        const format = getFlag('--format', args) || 'markdown';
        const javascript = args.includes('--js');
        const result = await reach.fetch(url, { format, javascript });
        if (format === 'json') {
          console.log(JSON.stringify(result.content, null, 2));
        } else {
          console.log(result.content);
        }
        console.log(`\n--- source: ${result.source}, format: ${result.format} ---`);
        break;
      }

      case 'act': {
        const url = args[0];
        const action = args[1];
        const target = args.slice(2).join(' ');
        if (!url || !action) { console.error('Usage: reach act <url> <click|type|submit|select> [target]'); process.exit(1); }
        const params = action === 'click' ? { text: target } : { text: target };
        const result = await reach.act(url, action, params);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'auth': {
        const service = args[0];
        const method = args[1] || 'cookie';
        if (!service) { console.error('Usage: reach auth <service> [cookie|login] [url]'); process.exit(1); }

        if (method === 'login') {
          const url = args[2] || getEnv(`${service.toUpperCase()}_LOGIN_URL`);
          const email = getEnv(`${service.toUpperCase()}_EMAIL`);
          const password = getEnv(`${service.toUpperCase()}_PASSWORD`);
          if (!url || !email || !password) {
            console.error(`Set ${service.toUpperCase()}_LOGIN_URL, ${service.toUpperCase()}_EMAIL, ${service.toUpperCase()}_PASSWORD in .env`);
            process.exit(1);
          }
          const result = await reach.authenticate(service, 'login', { url, email, password });
          console.log(JSON.stringify(result, null, 2));
        } else {
          const result = await reach.authenticate(service, 'cookie');
          console.log(JSON.stringify(result, null, 2));
        }
        break;
      }

      case 'sign': {
        const message = args.join(' ') || 'hello from reach';
        const result = await reach.sign(message);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'store': {
        const key = args[0];
        const value = args.slice(1).join(' ');
        if (!key) { console.error('Usage: reach store <key> [value]'); process.exit(1); }
        if (value) {
          let parsed;
          try { parsed = JSON.parse(value); } catch { parsed = value; }
          const result = reach.persist(key, parsed);
          console.log(JSON.stringify(result, null, 2));
        } else {
          const result = reach.recall(key);
          if (result === null) {
            console.log('(not found)');
          } else {
            console.log(typeof result === 'object' ? JSON.stringify(result, null, 2) : result);
          }
        }
        break;
      }

      case 'sessions': {
        const sessions = reach.listSessions();
        if (sessions.length === 0) {
          console.log('No saved sessions');
        } else {
          console.log('Saved sessions:');
          for (const s of sessions) {
            console.log(`  ${s.service} (${s.type})`);
          }
        }
        break;
      }

      case 'route': {
        const url = args[0];
        const type = getFlag('--type', args) || 'read';
        const plan = reach.route({ type, url });
        console.log(JSON.stringify(plan, null, 2));
        break;
      }

      case 'learn': {
        const url = args[0];
        if (!url) { console.error('Usage: reach learn <url> --needsJS --needsAuth --api <endpoint>'); process.exit(1); }
        const info = {};
        if (args.includes('--needsJS')) info.needsJS = true;
        if (args.includes('--needsAuth')) info.needsAuth = true;
        const api = getFlag('--api', args);
        if (api) info.api = { endpoint: api };
        reach.learnSite(url, info);
        console.log(`Learned about ${url}:`, JSON.stringify(info));
        break;
      }

      case 'see': {
        const url = args[0];
        if (!url) { console.error('Usage: reach see <url> ["question"]'); process.exit(1); }
        const question = args.slice(1).join(' ') || null;
        const result = await reach.see(url, question);
        console.log(`\nTitle: ${result.title}`);
        console.log(`URL: ${result.url}`);
        console.log(`Screenshot: ${result.screenshot}`);
        console.log(`Interactive elements: ${result.elements.length}`);
        if (question) console.log(`Question: ${question}`);
        console.log('\n--- Accessibility Tree ---');
        console.log(result.description);
        console.log('\n--- Interactive Elements ---');
        for (const el of result.elements.slice(0, 30)) {
          const label = el.text || '(unlabeled)';
          const href = el.href ? ` → ${el.href}` : '';
          console.log(`  [${el.tag}${el.type ? ':' + el.type : ''}] ${label}${href}`);
        }
        if (result.elements.length > 30) {
          console.log(`  ... and ${result.elements.length - 30} more`);
        }
        break;
      }

      case 'import-cookies': {
        const service = args[0];
        const filePath = args[1];
        const format = args[2] || 'auto';
        if (!service || !filePath) {
          console.error('Usage: reach import-cookies <service> <file-path> [format]');
          console.error('Formats: auto, playwright, editthiscookie, netscape');
          process.exit(1);
        }
        const result = reach.importCookies(service, filePath, format);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'export-instructions': {
        const browser = args[0] || 'chrome';
        console.log(reach.getExportInstructions(browser));
        break;
      }

      // --- New commands ---

      case 'replay': {
        const sessionFile = args[0];
        if (!sessionFile) {
          // List available recordings
          const recordings = listRecordings();
          if (recordings.length === 0) {
            console.log('No recordings found.');
          } else {
            console.log('Available recordings:');
            for (const r of recordings) {
              console.log(`  ${r.name}  (${r.entryCount} actions, ${r.duration || '?'})  ${r.startedAt || ''}`);
            }
          }
          break;
        }

        const session = loadRecording(sessionFile);
        console.log(formatTimeline(session));
        break;
      }

      case 'forms': {
        const forms = listForms();
        if (forms.length === 0) {
          console.log('No saved form data.');
        } else {
          console.log('Saved form memories:');
          for (const f of forms) {
            console.log(`  ${f.url || f.file}  (${f.fieldCount} fields)  ${f.lastUpdated || ''}`);
          }
        }
        break;
      }

      case 'webhook': {
        const port = parseInt(getFlag('--port', args) || '8430');
        const server = new WebhookServer({ port });

        // Register handlers from remaining args
        // Format: --on /path
        let i = 0;
        while (i < args.length) {
          if (args[i] === '--on' && i + 1 < args.length) {
            const hookPath = args[i + 1];
            server.on(hookPath, (payload, headers) => {
              console.log(`\n[${new Date().toISOString()}] Webhook received: ${hookPath}`);
              console.log(JSON.stringify(payload, null, 2));
            });
            i += 2;
          } else {
            i++;
          }
        }

        await server.start();
        console.log('Press Ctrl+C to stop');

        // Keep running until interrupted
        await new Promise((resolve) => {
          process.on('SIGINT', async () => {
            await server.stop();
            resolve();
          });
        });
        break;
      }

      case 'do': {
        const text = args.join(' ');
        if (!text) {
          console.error('Usage: reach do "<natural language command>"');
          console.error('Examples:');
          console.error('  reach do "go to github"');
          console.error('  reach do "search upwork for solidity jobs"');
          console.error('  reach do "screenshot basescan.org"');
          process.exit(1);
        }

        const plan = parseCommand(text);
        if (!plan) {
          console.error(`Could not understand: "${text}"`);
          console.error('Try: go to, search, click, type, email, send, watch, remember, screenshot, login');
          process.exit(1);
        }

        console.log(`Plan: ${plan.description}`);
        console.log(`  primitive: ${plan.primitive}, method: ${plan.method}`);
        console.log(`  params: ${JSON.stringify(plan.params)}`);
        console.log('');

        const result = await executeCommand(text, reach);
        if (result.error) {
          console.error(`Error: ${result.error}`);
        } else if (result.result) {
          console.log(typeof result.result === 'object'
            ? JSON.stringify(result.result, null, 2)
            : result.result);
        }
        break;
      }

      case 'parse': {
        const text = args.join(' ');
        if (!text) {
          console.error('Usage: reach parse "<natural language command>"');
          process.exit(1);
        }
        const plan = parseCommand(text);
        if (plan) {
          console.log(JSON.stringify(plan, null, 2));
        } else {
          console.log('Could not parse command');
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  } finally {
    await reach.close();
  }
}

function getFlag(flag, args) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return null;
}

function getEnv(key) {
  return process.env[key] || null;
}

function printHelp() {
  console.log(`
Reach — Agent Web Interface

Primitives:
  fetch <url> [--format markdown|html|json|screenshot] [--js]
    Fetch content from a URL

  act <url> <click|type|submit|select> [target]
    Interact with a web page (with error recovery)

  auth <service> [cookie|login] [url]
    Authenticate with a service

  sign <message>
    Sign a message with the configured wallet

  store <key> [value]
    Store or recall a value (omit value to recall)

  see <url> ["question"]
    Take screenshot + extract page structure for visual reasoning

Navigation:
  sessions
    List saved authentication sessions

  route <url> [--type read|interact|auth]
    See how the router would handle a task

  learn <url> [--needsJS] [--needsAuth] [--api <endpoint>]
    Teach the router about a site

Cookies:
  import-cookies <service> <file-path> [format]
    Import cookies from browser export (formats: auto, playwright, editthiscookie, netscape)

  export-instructions [chrome|firefox|manual]
    Print instructions for exporting cookies from a browser

Natural Language:
  do "<command>"
    Execute a natural language command (e.g. "go to github", "search upwork for solidity")

  parse "<command>"
    Parse a natural language command without executing

Recording:
  replay [session-file]
    Replay a recorded session (omit file to list recordings)

  forms
    List saved form memories

Webhook:
  webhook [--port 8430] [--on /path] [--on /path2]
    Start a webhook receiver server
`);
}

main();
