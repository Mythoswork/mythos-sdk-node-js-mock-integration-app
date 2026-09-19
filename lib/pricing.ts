// Single source of truth for what a calculation costs, shared between the
// server-side charge (pages/api/calculate.ts) and the client-side confirm
// dialog (pages/calculator.tsx) — they must always agree on the number.
export const CREDITS_PER_CALCULATION = 1;


// Chars-per-credit for the confirm-charge modal's reminder amount -- deliberately coarse
// (not a real token-cost model). The real LLM cost is only known after the provider
// responds, and is already billed automatically by /api/chat via the SDK's wallet hold;
// this number exists purely so the dialog isn't a hardcoded stub that means nothing to the
// person clicking Confirm -- a longer message reads as "this will cost a bit more."
const CHARS_PER_CHAT_CREDIT = 40;
const MAX_CHAT_CREDITS_ESTIMATE = 10;

export function estimateChatCredits(message: string): number {
  const byLength = Math.ceil(message.length / CHARS_PER_CHAT_CREDIT);
  return Math.min(MAX_CHAT_CREDITS_ESTIMATE, Math.max(1, byLength));
}
