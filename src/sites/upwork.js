import { authenticate, getSession } from '../primitives/authenticate.js';
import { fetch } from '../primitives/fetch.js';
import { solveCaptcha, detectCaptcha } from '../primitives/captcha.js';
import pool from '../browser.js';

/**
 * Upwork site skill.
 *
 * Login (with Turnstile CAPTCHA solving), search jobs, read details,
 * draft proposals, check messages.
 *
 * Credentials: UPWORK_EMAIL + UPWORK_PASSWORD in .env
 * CAPTCHA: Requires CAPSOLVER_API_KEY for Turnstile challenges
 */

const BASE_URL = 'https://www.upwork.com';
const SERVICE = 'upwork';

function getCredentials() {
  return {
    email: process.env.UPWORK_EMAIL,
    password: process.env.UPWORK_PASSWORD,
  };
}

/**
 * Login to Upwork.
 * Upwork uses Cloudflare Turnstile — CapSolver handles it automatically
 * via the browser pool's autoSolveCaptcha hook.
 *
 * @returns {object} { success, session }
 */
export async function login() {
  const existing = getSession(SERVICE);
  if (existing) {
    console.log('[upwork] Existing session found');
    return { success: true, session: existing, cached: true };
  }

  const { email, password } = getCredentials();
  if (!email || !password) {
    throw new Error('Set UPWORK_EMAIL + UPWORK_PASSWORD in .env');
  }

  // Upwork has a two-step login: email page → password page
  // The browser pool auto-detects and solves Turnstile on page load
  const page = await pool.getPage(SERVICE);

  try {
    console.log('[upwork] Starting login flow');
    await page.goto(`${BASE_URL}/ab/account-security/login`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Check for and solve CAPTCHA before proceeding
    const captchaResult = await solveCaptcha(page);
    if (captchaResult.type !== 'none') {
      console.log(`[upwork] CAPTCHA solved: ${captchaResult.type}`);
      await page.waitForTimeout(2000);
    }

    // Step 1: Enter email/username
    const usernameInput = await page.$('#login_username, input[name="login[username]"], input[type="email"]');
    if (usernameInput) {
      await usernameInput.fill(email);
      console.log('[upwork] Filled username');
    } else {
      throw new Error('Could not find username field');
    }

    // Click Continue
    const continueBtn = page.locator('#login_password_continue, button:has-text("Continue"), button[type="submit"]').first();
    if (await continueBtn.count() > 0) {
      await continueBtn.click();
      console.log('[upwork] Clicked Continue');
    }
    await page.waitForTimeout(3000);

    // Handle CAPTCHA after email submission
    const captcha2 = await solveCaptcha(page);
    if (captcha2.type !== 'none') {
      console.log(`[upwork] CAPTCHA after email: ${captcha2.type}`);
      await page.waitForTimeout(2000);
    }

    // Step 2: Enter password
    const passwordInput = await page.$('#login_password, input[name="login[password]"], input[type="password"]');
    if (passwordInput) {
      await passwordInput.fill(password);
      console.log('[upwork] Filled password');
    } else {
      throw new Error('Could not find password field');
    }

    // Click Log In
    const loginBtn = page.locator('#login_control_continue, button:has-text("Log in"), button:has-text("Log In"), button[type="submit"]').first();
    if (await loginBtn.count() > 0) {
      await loginBtn.click();
      console.log('[upwork] Clicked Log In');
    }

    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // Save cookies
    await pool.saveCookies(SERVICE);

    const currentUrl = page.url();
    console.log(`[upwork] Login complete. URL: ${currentUrl}`);

    return {
      success: !currentUrl.includes('login'),
      session: { type: 'cookie', domain: SERVICE, url: currentUrl },
    };
  } catch (e) {
    try { await pool.screenshot(page, 'upwork-login-fail'); } catch {}
    return { success: false, error: e.message };
  } finally {
    await page.close();
  }
}

/**
 * Search Upwork jobs by keyword.
 *
 * @param {string} query - Search keywords
 * @param {object} [options]
 * @param {string} [options.category] - Job category filter
 * @param {string} [options.budget] - 'any' | 'fixed' | 'hourly'
 * @param {number} [options.page] - Page number (default: 1)
 * @returns {object} { jobs: Array<{ title, url, description, budget, posted }> }
 */
export async function searchJobs(query, options = {}) {
  const { category, budget, page: pageNum = 1 } = options;

  let searchUrl = `${BASE_URL}/nx/search/jobs/?q=${encodeURIComponent(query)}&page=${pageNum}`;
  if (budget === 'fixed') searchUrl += '&payment_verified=1&job_type=fixed-price';
  if (budget === 'hourly') searchUrl += '&payment_verified=1&job_type=hourly';

  const browserPage = await pool.getPage(SERVICE);

  try {
    await browserPage.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await browserPage.waitForTimeout(3000);

    // Extract job listings from the search results page
    const jobs = await browserPage.evaluate(() => {
      const results = [];
      const cards = document.querySelectorAll('[data-test="job-tile-list"] section, .job-tile, article[data-ev-label]');

      for (const card of cards) {
        const titleEl = card.querySelector('h2 a, h3 a, .job-title a, [data-test="job-tile-title-link"]');
        const descEl = card.querySelector('.job-description, [data-test="job-description-text"], p');
        const budgetEl = card.querySelector('.budget, [data-test="budget"], [data-test="job-type-label"]');
        const postedEl = card.querySelector('.posted-on, [data-test="posted-on"], time, small');

        if (titleEl) {
          results.push({
            title: titleEl.textContent?.trim() || '',
            url: titleEl.href || '',
            description: descEl?.textContent?.trim().substring(0, 300) || '',
            budget: budgetEl?.textContent?.trim() || '',
            posted: postedEl?.textContent?.trim() || '',
          });
        }
      }
      return results;
    });

    await pool.saveCookies(SERVICE);

    return { jobs, query, page: pageNum, url: searchUrl };
  } catch (e) {
    return { jobs: [], query, error: e.message };
  } finally {
    await browserPage.close();
  }
}

/**
 * Read a specific job posting's full details.
 *
 * @param {string} jobUrl - Full Upwork job URL
 * @returns {object} { title, description, budget, clientInfo, skills, url }
 */
export async function readJobDetails(jobUrl) {
  const browserPage = await pool.getPage(SERVICE);

  try {
    await browserPage.goto(jobUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await browserPage.waitForTimeout(3000);

    const details = await browserPage.evaluate(() => {
      const title = document.querySelector('h1, .job-title, header h2')?.textContent?.trim() || '';
      const description = document.querySelector('.job-description, [data-test="description"], .break-word')?.textContent?.trim() || '';
      const budget = document.querySelector('.budget, [data-test="budget"]')?.textContent?.trim() || '';

      // Client info
      const clientSection = document.querySelector('.client-info, [data-test="client-info"]');
      const clientInfo = clientSection?.textContent?.trim().substring(0, 300) || '';

      // Skills
      const skillEls = document.querySelectorAll('.skills-list a, [data-test="skill"] span, .air3-badge');
      const skills = Array.from(skillEls).map(el => el.textContent?.trim()).filter(Boolean);

      return { title, description, budget, clientInfo, skills };
    });

    return { ...details, url: jobUrl };
  } catch (e) {
    return { error: e.message, url: jobUrl };
  } finally {
    await browserPage.close();
  }
}

/**
 * Draft and submit a proposal for a job.
 *
 * @param {string} jobUrl - Job posting URL
 * @param {object} proposal
 * @param {string} proposal.coverLetter - Cover letter text
 * @param {string} [proposal.rate] - Proposed rate (hourly or fixed)
 * @param {boolean} [proposal.submit] - Actually submit (default: false, just drafts)
 * @returns {object} { success, drafted, submitted }
 */
export async function submitProposal(jobUrl, proposal) {
  const { coverLetter, rate, submit = false } = proposal;

  if (!coverLetter) {
    throw new Error('submitProposal requires coverLetter');
  }

  const browserPage = await pool.getPage(SERVICE);

  try {
    // Navigate to the job and click Apply
    await browserPage.goto(jobUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await browserPage.waitForTimeout(3000);

    // Click Apply Now button
    const applyBtn = browserPage.locator('button:has-text("Apply Now"), a:has-text("Apply Now"), button:has-text("Submit a Proposal")').first();
    if (await applyBtn.count() > 0) {
      await applyBtn.click();
      await browserPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await browserPage.waitForTimeout(3000);
    }

    // Fill cover letter
    const coverLetterInput = await browserPage.$('textarea[name="coverLetter"], textarea.cover-letter, [data-test="cover-letter"] textarea, textarea');
    if (coverLetterInput) {
      await coverLetterInput.fill(coverLetter);
      console.log('[upwork] Filled cover letter');
    }

    // Fill rate if provided
    if (rate) {
      const rateInput = await browserPage.$('input[name="rate"], input[name="amount"], [data-test="rate-input"] input');
      if (rateInput) {
        await rateInput.fill(String(rate));
        console.log(`[upwork] Set rate: ${rate}`);
      }
    }

    if (submit) {
      // Actually submit the proposal
      const submitBtn = browserPage.locator('button:has-text("Submit"), button[type="submit"]:has-text("Send")').first();
      if (await submitBtn.count() > 0) {
        await submitBtn.click();
        await browserPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      }
      await pool.saveCookies(SERVICE);
      return { success: true, drafted: true, submitted: true, url: browserPage.url() };
    }

    await pool.saveCookies(SERVICE);
    return { success: true, drafted: true, submitted: false, url: browserPage.url() };
  } catch (e) {
    try { await pool.screenshot(browserPage, 'upwork-proposal-fail'); } catch {}
    return { success: false, error: e.message };
  } finally {
    await browserPage.close();
  }
}

/**
 * Check messages/responses in Upwork inbox.
 *
 * @returns {object} { messages: Array<{ from, subject, preview, date }> }
 */
export async function checkMessages() {
  const browserPage = await pool.getPage(SERVICE);

  try {
    await browserPage.goto(`${BASE_URL}/ab/messages`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await browserPage.waitForTimeout(3000);

    const messages = await browserPage.evaluate(() => {
      const results = [];
      const threads = document.querySelectorAll('.thread-list-item, [data-test="message-thread"], .msg-thread');

      for (const thread of threads) {
        const from = thread.querySelector('.name, .username, [data-test="sender-name"]')?.textContent?.trim() || '';
        const subject = thread.querySelector('.subject, [data-test="thread-subject"]')?.textContent?.trim() || '';
        const preview = thread.querySelector('.preview, .message-text, [data-test="message-preview"]')?.textContent?.trim().substring(0, 200) || '';
        const date = thread.querySelector('time, .date, [data-test="timestamp"]')?.textContent?.trim() || '';

        if (from || subject) {
          results.push({ from, subject, preview, date });
        }
      }
      return results;
    });

    await pool.saveCookies(SERVICE);
    return { messages };
  } catch (e) {
    return { messages: [], error: e.message };
  } finally {
    await browserPage.close();
  }
}

export default {
  login,
  searchJobs,
  readJobDetails,
  submitProposal,
  checkMessages,
};
