// Display the daily prize amount in whichever unit was configured for the round.
// Accepts either a winner doc ({ currency, amount_sol, amount_rollat }) or a
// stats-style object ({ prize_currency, fixed_prize_sol, fixed_prize_rollat }).
// Old winner docs (pre-currency-toggle) have no `currency` field; treat them
// as SOL for backwards compatibility.

const fmtSol = (n, dp = 2) =>
  `${(Number(n) || 0).toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })} SOL`;

const fmtRollat = (n) =>
  `${Math.round(Number(n) || 0).toLocaleString("en-US")} $ROLLAT`;

export function formatPrize(input, { solDecimals = 2 } = {}) {
  if (!input) return "—";
  const currency = input.currency || input.prize_currency || "SOL";
  if (currency === "ROLLAT") {
    const amt = input.amount_rollat ?? input.fixed_prize_rollat ?? 0;
    return fmtRollat(amt);
  }
  const amt = input.amount_sol ?? input.fixed_prize_sol ?? 0;
  return fmtSol(amt, solDecimals);
}

// Direct formatters for places that already have a raw number + currency.
export function formatAmount(amount, currency, { solDecimals = 2 } = {}) {
  if (currency === "ROLLAT") return fmtRollat(amount);
  return fmtSol(amount, solDecimals);
}

export const PRIZE_UNIT_LABEL = (currency) =>
  currency === "ROLLAT" ? "$ROLLAT" : "SOL";
