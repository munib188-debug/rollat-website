// Single source of truth for the $ROLLAT token mint and the buy/explorer
// links derived from it. Import from here rather than hardcoding the address.

export const ROLLAT_MINT = "6nkpP9ZZL2M3S9AFERydn3wxhzTMC2Dto72N6yK3pump";

export const ROLLAT_LINKS = {
  jupiter: `https://jup.ag/swap/SOL-${ROLLAT_MINT}`,
  pumpfun: `https://pump.fun/coin/${ROLLAT_MINT}`,
  raydium: `https://raydium.io/swap/?inputCurrency=sol&outputCurrency=${ROLLAT_MINT}`,
  dexscreener: `https://dexscreener.com/solana/${ROLLAT_MINT}`,
  birdeye: `https://birdeye.so/token/${ROLLAT_MINT}?chain=solana`,
  solscan: `https://solscan.io/token/${ROLLAT_MINT}`,
};

export const truncateMint = (mint = ROLLAT_MINT, head = 6, tail = 4) =>
  `${mint.slice(0, head)}···${mint.slice(-tail)}`;
