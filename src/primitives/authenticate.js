import fs from 'fs';
import path from 'path';
import pool, { SESSIONS_DIR } from '../browser.js';

/**
 * Session management primitive. Handles authentication flows.
 *
 * @param {string} service - Service name (e.g., 'cantina', 'upwork')
 * @param {string} method - 'cookie' | 'login' | 'apikey'
 * @param {object} credentials
 * @param {string} credentials.url - Login page URL
 * @param {string} credentials.email - Email/username
 * @param {string} credentials.password - Password
 * @param {string} credentials.apiKey - API key (for apikey method)
 * @param {string} credentials.headerName - Header name for API key (default: 'Authorization')
 * @returns {object} { success, method, service, session }
 */
export async function authenticate(service, method, credentials = {}) {
  switch (method) {
    case 'cookie':
      return await authWithCookie(service);
    case 'login':
      return await authWithLogin(service, credentials);
    case 'apikey':
      return await authWithApiKey(service, credentials);
    default:
      throw new Error(`Unknown auth method: ${method}`);
  }
}

async function authWithCookie(service) {
  const cookiePath = path.join(SESSIONS_DIR, `cookies-${service}.json`);

  if (!fs.existsSync(cookiePath)) {
    return { success: false, method: 'cookie', service, error: 'No saved cookies' };
  }

  try {
    const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));

    // Check if cookies have expired
    const now = Date.now() / 1000;
    const validCookies = cookies.filter(c => !c.expires || c.expires > now);

    if (validCookies.length === 0) {
      return { success: false, method: 'cookie', service, error: 'All cookies expired' };
    }

    return {
      success: true,
      method: 'cookie',
      service,
      session: { type: 'cookie', domain: service, cookieCount: validCookies.length },
    };
  } catch (e) {
    return { success: false, method: 'cookie', service, error: e.message };
  }
}

async function authWithLogin(service, credentials) {
  const { url, email, password } = credentials;

  if (!url || !email || !password) {
    throw new Error('login requires url, email, and password');
  }

  const domain = pool.getDomain(url);
  const page = await pool.getPage(domain);

  try {
    console.log(`[auth] Logging into ${service} at ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // Step 1: Find and fill email field
    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[name="username"]',
      'input[id="email"]',
      'input[id="username"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="Email" i]',
    ];

    let emailFilled = false;
    for (const sel of emailSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.fill(email);
        emailFilled = true;
        console.log(`[auth] Filled email with selector: ${sel}`);
        break;
      }
    }

    if (!emailFilled) {
      throw new Error('Could not find email input field');
    }

    // Check if password field is already visible (single-page login)
    const pwField = await page.$('input[type="password"]');
    if (pwField) {
      // Single-page login — fill password and submit
      await pwField.fill(password);
      console.log('[auth] Single-page login — filled password');

      await clickSubmit(page);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    } else {
      // Two-step login (Auth0 style) — submit email first
      await clickSubmit(page);
      await page.waitForTimeout(2000);

      // Now fill password
      const pwSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input[id="password"]',
      ];

      let pwFilled = false;
      for (const sel of pwSelectors) {
        const el = await page.$(sel);
        if (el) {
          await el.fill(password);
          pwFilled = true;
          console.log(`[auth] Filled password with selector: ${sel}`);
          break;
        }
      }

      if (!pwFilled) {
        throw new Error('Could not find password field after email step');
      }

      await clickSubmit(page);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    // Save cookies
    await pool.saveCookies(domain);

    // Also save with service name for easy lookup
    const context = pool.contexts.get(domain);
    if (context) {
      const cookies = await context.cookies();
      const cookiePath = path.join(SESSIONS_DIR, `cookies-${service}.json`);
      fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
      console.log(`[auth] Saved ${cookies.length} cookies for ${service}`);
    }

    const currentUrl = page.url();
    console.log(`[auth] Login complete. Current URL: ${currentUrl}`);

    return {
      success: true,
      method: 'login',
      service,
      session: { type: 'cookie', domain, url: currentUrl },
    };
  } catch (e) {
    // Take screenshot on failure for debugging
    try {
      await pool.screenshot(page, `auth-fail-${service}`);
    } catch {}
    return { success: false, method: 'login', service, error: e.message };
  } finally {
    await page.close();
  }
}

async function authWithApiKey(service, credentials) {
  const { apiKey, headerName = 'Authorization' } = credentials;

  if (!apiKey) {
    throw new Error('apikey requires apiKey');
  }

  // Store API key session info
  const sessionPath = path.join(SESSIONS_DIR, `apikey-${service}.json`);
  const session = {
    type: 'apikey',
    service,
    headerName,
    apiKey,
    created: new Date().toISOString(),
  };
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));

  return {
    success: true,
    method: 'apikey',
    service,
    session: { type: 'apikey', headerName },
  };
}

async function clickSubmit(page) {
  const submitSelectors = [
    'button[type="submit"]',
    'button[name="action"]',
    'input[type="submit"]',
    'button:has-text("Continue")',
    'button:has-text("Log in")',
    'button:has-text("Login")',
    'button:has-text("Sign in")',
    'button:has-text("Sign In")',
    'button:has-text("Submit")',
    'button:has-text("Next")',
  ];

  for (const sel of submitSelectors) {
    const el = await page.$(sel);
    if (el) {
      await el.click();
      console.log(`[auth] Clicked submit: ${sel}`);
      return;
    }
  }

  // Fallback: press Enter
  await page.keyboard.press('Enter');
  console.log('[auth] Pressed Enter as submit fallback');
}

/**
 * Get saved session info for a service.
 */
export function getSession(service) {
  // Check for cookie session
  const cookiePath = path.join(SESSIONS_DIR, `cookies-${service}.json`);
  if (fs.existsSync(cookiePath)) {
    const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
    return { type: 'cookie', service, cookieCount: cookies.length };
  }

  // Check for API key session
  const apikeyPath = path.join(SESSIONS_DIR, `apikey-${service}.json`);
  if (fs.existsSync(apikeyPath)) {
    const session = JSON.parse(fs.readFileSync(apikeyPath, 'utf-8'));
    return { type: 'apikey', service, headerName: session.headerName };
  }

  return null;
}

/**
 * List all saved sessions.
 */
export function listSessions() {
  const sessions = [];
  const files = fs.readdirSync(SESSIONS_DIR);
  for (const file of files) {
    if (file.startsWith('cookies-') && file.endsWith('.json')) {
      const service = file.replace('cookies-', '').replace('.json', '');
      sessions.push({ service, type: 'cookie' });
    } else if (file.startsWith('apikey-') && file.endsWith('.json')) {
      const service = file.replace('apikey-', '').replace('.json', '');
      sessions.push({ service, type: 'apikey' });
    }
  }
  return sessions;
}
