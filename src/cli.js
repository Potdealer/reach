#!/usr/bin/env node

import dotenv from 'dotenv';
dotenv.config();

import { Reach } from './index.js';

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

Commands:
  fetch <url> [--format markdown|html|json|screenshot] [--js]
    Fetch content from a URL

  act <url> <click|type|submit|select> [target]
    Interact with a web page

  auth <service> [cookie|login] [url]
    Authenticate with a service

  sign <message>
    Sign a message with the configured wallet

  store <key> [value]
    Store or recall a value (omit value to recall)

  sessions
    List saved authentication sessions

  route <url> [--type read|interact|auth]
    See how the router would handle a task

  learn <url> [--needsJS] [--needsAuth] [--api <endpoint>]
    Teach the router about a site

  see <url> ["question"]
    Take screenshot + extract page structure for visual reasoning

  import-cookies <service> <file-path> [format]
    Import cookies from browser export (formats: auto, playwright, editthiscookie, netscape)

  export-instructions [chrome|firefox|manual]
    Print instructions for exporting cookies from a browser
`);
}

main();
