// Single source of truth for what a calculation costs, shared between the
// server-side charge (pages/api/calculate.ts) and the client-side confirm
// dialog (pages/calculator.tsx) — they must always agree on the USD amount.
export const USD_PER_CALCULATION = 0.15;
