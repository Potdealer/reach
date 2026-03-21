import pool from '../browser.js';

/**
 * Web interaction primitive. Performs actions on web pages.
 *
 * @param {string} url - URL to act on
 * @param {string} action - 'click' | 'type' | 'submit' | 'select' | 'scroll'
 * @param {object} params - Action parameters
 * @param {string} params.selector - CSS selector
 * @param {string} params.text - Text to match (for click) or type (for type)
 * @param {object} params.data - Form data (for submit)
 * @param {string} params.value - Value to select (for select)
 * @param {string} params.direction - 'up' | 'down' (for scroll)
 * @param {string} params.session - Session/cookie domain to use
 * @returns {object} { success, action, result, url }
 */
export async function act(url, action, params = {}) {
  const domain = pool.getDomain(url);
  const page = await pool.getPage(params.session || domain);

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    let result;

    switch (action) {
      case 'click':
        result = await doClick(page, params);
        break;
      case 'type':
        result = await doType(page, params);
        break;
      case 'submit':
        result = await doSubmit(page, params);
        break;
      case 'select':
        result = await doSelect(page, params);
        break;
      case 'scroll':
        result = await doScroll(page, params);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    // Save cookies after interaction
    await pool.saveCookies(domain);

    return { success: true, action, result, url };
  } catch (e) {
    return { success: false, action, error: e.message, url };
  } finally {
    await page.close();
  }
}

async function doClick(page, params) {
  const { selector, text } = params;

  if (selector) {
    await page.click(selector);
    return { clicked: selector };
  }

  if (text) {
    await page.locator(`text=${text}`).filter({ visible: true }).first().click();
    return { clicked: `text="${text}"` };
  }

  throw new Error('click requires selector or text');
}

async function doType(page, params) {
  const { selector, text } = params;

  if (!text) throw new Error('type requires text');

  if (selector) {
    await page.fill(selector, text);
    return { typed: text, into: selector };
  }

  // Try common input selectors
  const selectors = [
    'input:focus',
    'input[type="text"]',
    'input[type="search"]',
    'textarea',
    'input:not([type="hidden"]):not([type="submit"])',
  ];

  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      await el.fill(text);
      return { typed: text, into: sel };
    }
  }

  throw new Error('No input field found');
}

async function doSubmit(page, params) {
  const { data, selector } = params;

  if (data && typeof data === 'object') {
    // Fill form fields by name or label
    for (const [key, value] of Object.entries(data)) {
      // Try by name attribute
      const byName = await page.$(`[name="${key}"]`);
      if (byName) {
        const tagName = await byName.evaluate(el => el.tagName.toLowerCase());
        if (tagName === 'select') {
          await byName.selectOption(value);
        } else {
          await byName.fill(String(value));
        }
        continue;
      }

      // Try by label
      const byLabel = await page.$(`label:has-text("${key}") + input, label:has-text("${key}") + select, label:has-text("${key}") + textarea`);
      if (byLabel) {
        await byLabel.fill(String(value));
        continue;
      }

      console.log(`[act] Could not find field for: ${key}`);
    }
  }

  // Click submit button
  const submitSelector = selector || 'button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Send")';
  await page.locator(submitSelector).filter({ visible: true }).first().click();

  // Wait for navigation or response
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  const pageText = await page.innerText('body').catch(() => '');
  return { submitted: true, pagePreview: pageText.slice(0, 500) };
}

async function doSelect(page, params) {
  const { selector, value, text } = params;

  if (selector) {
    if (value) {
      await page.selectOption(selector, value);
    } else if (text) {
      await page.selectOption(selector, { label: text });
    }
    return { selected: value || text, from: selector };
  }

  // Try clicking option text in a custom dropdown
  if (text) {
    await page.getByRole('option', { name: text }).click();
    return { selected: text };
  }

  throw new Error('select requires selector+value or text');
}

async function doScroll(page, params) {
  const { direction = 'down', amount = 500 } = params;
  const delta = direction === 'up' ? -amount : amount;
  await page.mouse.wheel(0, delta);
  await page.waitForTimeout(500);
  return { scrolled: direction, amount };
}
