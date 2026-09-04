/**
 * Fixed USD to INR exchange rate.
 *
 * NOTE: This is a fixed conversion rate as of September 4, 2026 (not a live/real-time rate).
 * It may need periodic manual updates to stay reasonably accurate with market exchange fluctuations.
 */
export const USD_TO_INR_RATE = 94.466;

/**
 * Converts a USD amount into INR paise (the smallest currency unit Razorpay expects),
 * rounding to the nearest whole integer paise.
 *
 * 1 USD = 94.466 INR
 * 1 INR = 100 paise
 *
 * Example:
 *   convertUsdToInrPaise(5) => Math.round(5 * 94.466 * 100) = 47233 paise (₹472.33)
 *
 * @param usdAmount - Amount in USD
 * @returns Amount in INR paise (integer)
 */
export function convertUsdToInrPaise(usdAmount: number): number {
  return Math.round(usdAmount * USD_TO_INR_RATE * 100);
}
