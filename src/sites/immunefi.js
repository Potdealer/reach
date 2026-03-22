import { fetch } from '../primitives/fetch.js';
import pool from '../browser.js';

/**
 * Immunefi site skill.
 *
 * Browse active bounty programs, read scope/rules, submit bug reports.
 * Immunefi is mostly public (no auth needed to browse).
 * Bug submission requires login — handled via browser.
 */

const BASE_URL = 'https://immunefi.com';
const SERVICE = 'immunefi';

/**
 * Get list of active bounty programs.
 *
 * @param {object} [options]
 * @param {string} [options.sort] - 'reward' | 'newest' | 'tvl'
 * @param {string} [options.category] - 'smart_contracts' | 'websites' | 'blockchain_dlt'
 * @returns {object} { programs: Array<{ name, url, maxReward, category }> }
 */
export async function listPrograms(options = {}) {
  // Immunefi has a public API for bounties
  try {
    const apiResult = await fetch('https://immunefi.com/api/bounty', { format: 'json' });
    if (apiResult.content && Array.isArray(apiResult.content)) {
      let programs = apiResult.content.map(b => ({
        id: b.id,
        name: b.project || b.name,
        url: `${BASE_URL}/bug-bounty/${b.id}`,
        maxReward: b.maxBounty || b.maximumReward,
        category: b.category,
        launchDate: b.launchDate,
        updatedDate: b.updatedDate,
      }));

      if (options.category) {
        programs = programs.filter(p =>
          p.category?.toLowerCase().includes(options.category.toLowerCase())
        );
      }

      if (options.sort === 'reward') {
        programs.sort((a, b) => (parseFloat(b.maxReward) || 0) - (parseFloat(a.maxReward) || 0));
      }

      return { programs, source: 'api' };
    }
  } catch (e) {
    console.log(`[immunefi] API fetch failed: ${e.message}, falling back to browser`);
  }

  // Fallback: browser scrape
  const result = await fetch(`${BASE_URL}/explore`, {
    format: 'html',
    javascript: true,
  });

  const programs = parseProgramList(result.content);
  return { programs, source: 'browser' };
}

/**
 * Read a specific bounty program's scope and rules.
 *
 * @param {string} programId - Program slug/ID or full URL
 * @returns {object} { name, description, scope, rewards, rules, assets }
 */
export async function readProgram(programId) {
  const url = programId.startsWith('http')
    ? programId
    : `${BASE_URL}/bug-bounty/${programId}`;

  // Try API first
  try {
    const apiResult = await fetch(`${url}/scope`, { format: 'html', javascript: true });
    if (apiResult.content) {
      return {
        url,
        content: apiResult.content,
        source: apiResult.source,
      };
    }
  } catch {}

  // Browser fallback
  const browserPage = await pool.getPage(SERVICE);

  try {
    await browserPage.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await browserPage.waitForTimeout(3000);

    const details = await browserPage.evaluate(() => {
      const name = document.querySelector('h1')?.textContent?.trim() || '';
      const description = document.querySelector('[class*="description"], [class*="about"]')?.textContent?.trim() || '';

      // Get scope/assets
      const scopeEls = document.querySelectorAll('table tr, [class*="scope"] [class*="row"], [class*="asset"]');
      const scope = Array.from(scopeEls).map(el => el.textContent?.trim()).filter(Boolean);

      // Get reward tiers
      const rewardEls = document.querySelectorAll('[class*="reward"], [class*="bounty"]');
      const rewards = Array.from(rewardEls).map(el => el.textContent?.trim()).filter(Boolean);

      const fullText = document.body?.innerText || '';

      return { name, description, scope, rewards, fullText: fullText.substring(0, 5000) };
    });

    return { ...details, url };
  } catch (e) {
    return { error: e.message, url };
  } finally {
    await browserPage.close();
  }
}

/**
 * Submit a bug report to an Immunefi program.
 * Requires authentication (Immunefi uses email/password or wallet login).
 *
 * @param {string} programId - Program slug/ID
 * @param {object} report
 * @param {string} report.title - Bug title
 * @param {string} report.severity - 'Critical' | 'High' | 'Medium' | 'Low' | 'Informational'
 * @param {string} report.description - Full bug description
 * @param {string} [report.impact] - Impact description
 * @param {string} [report.poc] - Proof of concept
 * @returns {object} { success, url }
 */
export async function submitReport(programId, report) {
  const { title, severity, description, impact, poc } = report;

  if (!title || !severity || !description) {
    throw new Error('submitReport requires title, severity, and description');
  }

  const browserPage = await pool.getPage(SERVICE);

  try {
    const url = `${BASE_URL}/bug-bounty/${programId}/submit-report`;
    await browserPage.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await browserPage.waitForTimeout(3000);

    // Check if we need to login
    const currentUrl = browserPage.url();
    if (currentUrl.includes('login') || currentUrl.includes('sign-in')) {
      console.log('[immunefi] Login required for report submission');
      return {
        success: false,
        error: 'Login required. Use browser to authenticate with Immunefi first.',
        loginUrl: currentUrl,
      };
    }

    // Fill report form
    // Title
    const titleInput = await browserPage.$('input[name="title"], input[placeholder*="title" i], #title');
    if (titleInput) await titleInput.fill(title);

    // Severity
    const severityEl = await browserPage.$('select[name="severity"], [name="severity"]');
    if (severityEl) {
      await severityEl.selectOption({ label: severity });
    } else {
      // Try clicking severity option
      const sevBtn = browserPage.locator(`text=${severity}`).first();
      if (await sevBtn.count() > 0) await sevBtn.click();
    }

    // Description
    const descInput = await browserPage.$('textarea[name="description"], textarea[name="vulnerability_description"], [contenteditable="true"]');
    if (descInput) {
      let fullDesc = description;
      if (impact) fullDesc += `\n\n## Impact\n\n${impact}`;
      if (poc) fullDesc += `\n\n## Proof of Concept\n\n\`\`\`\n${poc}\n\`\`\``;
      await descInput.fill(fullDesc);
    }

    // Submit
    const submitBtn = browserPage.locator('button[type="submit"], button:has-text("Submit"), button:has-text("Submit Report")').first();
    if (await submitBtn.count() > 0) {
      await submitBtn.click();
      await browserPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    await pool.saveCookies(SERVICE);

    return {
      success: true,
      url: browserPage.url(),
    };
  } catch (e) {
    try { await pool.screenshot(browserPage, 'immunefi-submit-fail'); } catch {}
    return { success: false, error: e.message };
  } finally {
    await browserPage.close();
  }
}

/**
 * Parse program list from Immunefi explore page HTML.
 */
function parseProgramList(html) {
  const programs = [];

  // Extract program cards — best effort
  const cardMatches = html?.match(/bug-bounty\/([a-z0-9-]+)/gi) || [];
  const seen = new Set();

  for (const match of cardMatches) {
    const slug = match.replace('bug-bounty/', '');
    if (!seen.has(slug) && slug.length > 2) {
      seen.add(slug);
      programs.push({
        id: slug,
        name: slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        url: `${BASE_URL}/${match}`,
      });
    }
  }

  return programs;
}

export default {
  listPrograms,
  readProgram,
  submitReport,
};
