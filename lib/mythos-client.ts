"use client";

/**
 * Browser-side helper: asks the parent Mythos dashboard (when this page is
 * running inside Mythos's iframe) to confirm a charge before you actually
 * call reportUsage. Ported from
 * mythos-sdk-python-mock-integration-app/templates/calculator.html's
 * confirmCharge() — same postMessage protocol, so it works against the same
 * dashboard on the other side of the iframe.
 *
 * Resolves `false` (fail closed) when: not embedded in an iframe, the
 * dashboard doesn't respond within `timeoutMs`, or the user declines.
 * Only resolves `true` on an explicit `{ approved: true }` response.
 */
export function confirmCharge(
  credits: number,
  reason: string,
  timeoutMs = 10000,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (window === window.parent) {
      resolve(false);
      return;
    }

    const requestId = crypto.randomUUID();
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      window.parent.postMessage(
        { type: "mythos:confirm-charge-timeout", requestId },
        "*",
      );
      cleanup();
      resolve(false);
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      if (event.source !== window.parent) return;
      const data = event.data;
      if (
        !data ||
        data.type !== "mythos:confirm-charge-response" ||
        data.requestId !== requestId
      ) {
        return;
      }
      cleanup();
      resolve(!!data.approved);
    }

    function cleanup() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    }

    window.addEventListener("message", onMessage);
    window.parent.postMessage(
      { type: "mythos:confirm-charge", requestId, credits, reason },
      "*",
    );
  });
}
