import {
  reportUsage,
  MythosError,
  InsufficientFundsError,
  SessionNotFoundError,
} from "@mythos-work/sdk";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { sessionJti, credits, reason } = await request.json();

  if (typeof sessionJti !== "string" || typeof credits !== "number") {
    return Response.json(
      { error: "Missing sessionJti or credits" },
      { status: 400 },
    );
  }

  try {
    await reportUsage(sessionJti, { credits, reason });
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof InsufficientFundsError) {
      return Response.json({ error: err.message }, { status: 402 });
    }
    if (err instanceof SessionNotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof MythosError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    return Response.json({ error: "Failed to report usage" }, { status: 503 });
  }
}
