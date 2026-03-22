import { authenticate, getSession } from '../primitives/authenticate.js';
import { fetch } from '../primitives/fetch.js';
import { act } from '../primitives/act.js';
import pool from '../browser.js';

/**
 * Code4rena site skill.
 *
 * Login, browse audits, read scope, submit findings, check status.
 * Credentials: C4_EMAIL + C4_PASSWORD in .env (falls back to UPWORK_EMAIL + UPWORK_PASSWORD)
 */

const BASE_URL = 'https://code4rena.com';
const SERVICE = 'code4rena';

function getCredentials() {
  return {
    email: process.env.C4_EMAIL || process.env.UPWORK_EMAIL,
    password: process.env.C4_PASSWORD || process.env.UPWORK_PASSWORD,
  };
}

/**
 * Login to Code4rena.
 * Uses browser-based auth — C4 uses GitHub OAuth or email login.
 *
 * @returns {object} { success, session }
 */
export async function login() {
  // Check for existing session first
  const existing = getSession(SERVICE);
  if (existing) {
    console.log('[c4] Existing session found');
    return { success: true, session: existing, cached: true };
  }

  const { email, password } = getCredentials();
  if (!email || !password) {
    throw new Error('Set C4_EMAIL + C4_PASSWORD (or UPWORK_EMAIL + UPWORK_PASSWORD) in .env');
  }

  const result = await authenticate(SERVICE, 'login', {
    url: `${BASE_URL}/login`,
    email,
    password,
  });

  return result;
}

/**
 * Get list of active audit contests.
 *
 * @returns {object} { contests: Array<{ title, url, prize, startDate, endDate, status }> }
 */
export async function getActiveAudits() {
  // C4 is a JS-rendered SPA — need browser
  const result = await fetch(`${BASE_URL}/audits`, {
    format: 'html',
    javascript: true,
    session: SERVICE,
  });

  // Parse contest cards from the rendered HTML
  const contests = parseContests(result.content);
  return { contests, source: result.source, url: result.url };
}

/**
 * Read audit scope and details.
 *
 * @param {string} contestSlug - Contest slug or full URL
 * @returns {object} { title, description, scope, prize, dates, repo }
 */
export async function readAuditDetails(contestSlug) {
  const url = contestSlug.startsWith('http')
    ? contestSlug
    : `${BASE_URL}/audits/${contestSlug}`;

  const result = await fetch(url, {
    format: 'html',
    javascript: true,
    session: SERVICE,
  });

  return {
    url,
    content: result.content,
    format: result.format,
    source: result.source,
  };
}

/**
 * Submit a finding to an active audit.
 *
 * @param {string} contestSlug - Contest slug or URL
 * @param {object} finding
 * @param {string} finding.title - Finding title
 * @param {string} finding.severity - 'High' | 'Medium' | 'QA' | 'Gas'
 * @param {string} finding.description - Finding body (markdown)
 * @param {string} [finding.poc] - Proof of concept code
 * @returns {object} { success, result }
 */
export async function submitFinding(contestSlug, finding) {
  const { title, severity, description, poc } = finding;

  if (!title || !severity || !description) {
    throw new Error('submitFinding requires title, severity, and description');
  }

  const url = contestSlug.startsWith('http')
    ? contestSlug
    : `${BASE_URL}/audits/${contestSlug}`;

  // Navigate to the submit page
  const domain = pool.getDomain(url);
  const page = await pool.getPage(SERVICE);

  try {
    // Go to the contest submit page
    const submitUrl = `${url}/submit`;
    await page.goto(submitUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Fill in the finding form
    // Title
    const titleInput = await page.$('input[name="title"], input[placeholder*="title" i], #title');
    if (titleInput) {
      await titleInput.fill(title);
    }

    // Severity selector
    const severitySelect = await page.$('select[name="severity"], [name="risk"]');
    if (severitySelect) {
      await severitySelect.selectOption({ label: severity });
    } else {
      // Try clicking a severity button/radio
      const sevButton = page.locator(`text=${severity}`).first();
      if (await sevButton.count() > 0) {
        await sevButton.click();
      }
    }

    // Description / body
    const bodyInput = await page.$('textarea[name="body"], textarea[name="description"], textarea.markdown-editor, [contenteditable="true"]');
    if (bodyInput) {
      const fullBody = poc ? `${description}\n\n## Proof of Concept\n\n\`\`\`solidity\n${poc}\n\`\`\`` : description;
      await bodyInput.fill(fullBody);
    }

    // Submit
    const submitBtn = page.locator('button[type="submit"], button:has-text("Submit"), button:has-text("Submit Finding")').first();
    if (await submitBtn.count() > 0) {
      await submitBtn.click();
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    await pool.saveCookies(SERVICE);

    const pageText = await page.innerText('body').catch(() => '');
    return {
      success: true,
      url: page.url(),
      preview: pageText.slice(0, 500),
    };
  } catch (e) {
    try { await pool.screenshot(page, 'c4-submit-fail'); } catch {}
    return { success: false, error: e.message };
  } finally {
    await page.close();
  }
}

/**
 * Check submission status for a contest.
 *
 * @param {string} [contestSlug] - Specific contest, or omit for all
 * @returns {object} { submissions }
 */
export async function checkSubmissions(contestSlug) {
  const url = contestSlug
    ? `${BASE_URL}/audits/${contestSlug}/submissions`
    : `${BASE_URL}/account`;

  const result = await fetch(url, {
    format: 'html',
    javascript: true,
    session: SERVICE,
  });

  return {
    url,
    content: result.content,
    source: result.source,
  };
}

/**
 * Parse contest cards from C4 audits page HTML.
 * Best-effort extraction from rendered HTML.
 */
function parseContests(html) {
  const contests = [];

  // C4 contest cards typically have titles in h2/h3 and prize amounts
  const titleMatches = html.match(/<h[23][^>]*>(.*?)<\/h[23]>/gi) || [];
  for (const match of titleMatches) {
    const title = match.replace(/<[^>]+>/g, '').trim();
    if (title && title.length > 3 && !title.match(/^(code4rena|audits|home)/i)) {
      contests.push({ title });
    }
  }

  return contests;
}

export default {
  login,
  getActiveAudits,
  readAuditDetails,
  submitFinding,
  checkSubmissions,
};
