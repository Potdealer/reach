/**
 * Payment primitive. Handles x402, crypto, and fiat payments.
 * STUB — not yet implemented.
 *
 * @param {string} recipient - Address or payment endpoint
 * @param {string|number} amount - Amount to pay
 * @param {object} options
 * @param {string} options.currency - 'ETH' | 'USDC' | 'x402' (default: 'ETH')
 * @param {string} options.chain - Chain name (default: 'base')
 * @returns {object} Payment receipt
 */
export async function pay(recipient, amount, options = {}) {
  const { currency = 'ETH', chain = 'base' } = options;

  console.log(`[pay] Not yet implemented. ${amount} ${currency} to ${recipient} on ${chain}`);
  console.log('[pay] Future: x402 HTTP payments, ETH/ERC-20 transfers, Stripe API');

  return {
    status: 'stub',
    recipient,
    amount,
    currency,
    chain,
  };
}
