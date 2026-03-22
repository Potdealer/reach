import nodeFetch from 'node-fetch';

/**
 * Email primitive — send email via Resend API.
 *
 * From: ollie@exoagent.xyz
 * Supports HTML and plain text.
 *
 * Requires RESEND_API_KEY in .env
 */

const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'ollie@exoagent.xyz';

/**
 * Send an email.
 *
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} body - Email body (plain text or HTML)
 * @param {object} [options]
 * @param {string} [options.from] - Sender address (default: ollie@exoagent.xyz)
 * @param {boolean} [options.html] - Treat body as HTML (default: false, auto-detected)
 * @param {string} [options.replyTo] - Reply-to address
 * @param {string[]} [options.cc] - CC recipients
 * @param {string[]} [options.bcc] - BCC recipients
 * @param {string} [options.apiKey] - Resend API key (falls back to RESEND_API_KEY env)
 * @returns {object} { success, id, to, subject }
 */
export async function sendEmail(to, subject, body, options = {}) {
  const {
    from = DEFAULT_FROM,
    html: isHtml,
    replyTo,
    cc,
    bcc,
    apiKey,
  } = options;

  const resendKey = apiKey || process.env.RESEND_API_KEY;
  if (!resendKey) {
    throw new Error('No Resend API key. Set RESEND_API_KEY in .env');
  }

  if (!to || !subject || !body) {
    throw new Error('sendEmail requires to, subject, and body');
  }

  // Auto-detect HTML
  const bodyIsHtml = isHtml !== undefined ? isHtml : body.includes('<') && body.includes('>');

  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
  };

  if (bodyIsHtml) {
    payload.html = body;
  } else {
    payload.text = body;
  }

  if (replyTo) payload.reply_to = replyTo;
  if (cc) payload.cc = Array.isArray(cc) ? cc : [cc];
  if (bcc) payload.bcc = Array.isArray(bcc) ? bcc : [bcc];

  console.log(`[email] Sending to ${to}: "${subject}"`);

  const response = await nodeFetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json();

  if (!response.ok) {
    const errorMsg = result.message || result.error || JSON.stringify(result);
    console.log(`[email] Failed: ${errorMsg}`);
    return {
      success: false,
      error: errorMsg,
      statusCode: response.status,
    };
  }

  console.log(`[email] Sent successfully. ID: ${result.id}`);

  return {
    success: true,
    id: result.id,
    to,
    subject,
    from,
  };
}

export default { sendEmail };
