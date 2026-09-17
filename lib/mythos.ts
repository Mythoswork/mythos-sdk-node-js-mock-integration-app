/**
 * Adapter that runs @mythos-work/sdk's Express `requireLaunchToken()`
 * middleware inside a Next.js Route Handler, by faking a minimal Express-like
 * req/res. Pattern from mythos-sdk/docs-site/docs/guides/nextjs.md.
 *
 * Note: `handshakeRoute()` is NOT run through this shim (and isn't used here
 * at all) — it returns an Express `Router`, which dispatches by matching
 * `req.method`/`req.url` against its internally registered path. A minimal
 * fake req/res (as this shim provides) doesn't give it enough to match,
 * so the Router silently falls through without ever validating the token.
 * `requireLaunchToken()` doesn't have this problem: it's a plain
 * `RequestHandler` that reads `req.query['lt']` directly, no route matching
 * involved, so it works correctly through this shim.
 *
 * handshakeRoute() has no Next.js-native equivalent in the SDK yet — see
 * runHandshake() below, which reimplements the same check by hand against
 * the Web Request/Response API instead of going through this shim.
 */
import { jwtVerify, errors, createRemoteJWKSet } from "jose";
import { requireLaunchToken, type MythosSession } from "@mythos-work/sdk";

type ShimReq = {
  query: Record<string, string | undefined>;
  mythos?: MythosSession;
};
type ShimRes = {
  status: (code: number) => ShimRes;
  json: (body: unknown) => void;
};
type ExpressLikeHandler = (
  req: ShimReq,
  res: ShimRes,
  next: () => void,
) => void | Promise<void>;

interface HandlerResult {
  status: number;
  body: unknown;
}

function runExpressHandler(
  handler: ExpressLikeHandler,
  lt: string | null,
): Promise<HandlerResult> {
  return new Promise((resolve) => {
    let statusCode = 200;
    const req: ShimReq = { query: { lt: lt ?? undefined } };
    const res: ShimRes = {
      status(code) {
        statusCode = code;
        return res;
      },
      json(body) {
        resolve({ status: statusCode, body });
      },
    };
    void handler(req, res, () => {
      resolve({ status: 200, body: { ok: true, session: req.mythos } });
    });
  });
}

export async function verifyAndConsumeLaunchToken(
  lt: string | null,
): Promise<HandlerResult> {
  return runExpressHandler(requireLaunchToken() as ExpressLikeHandler, lt);
}

/**
 * Hand-written equivalent of @mythos-work/sdk's `handshakeRoute()` (see
 * packages/node/src/handshake.ts) for Next.js Route Handlers. Copy this
 * whole function (plus the `jose` import) into your own project's
 * lib/mythos.ts — it has no dependencies beyond `jose`, which
 * @mythos-work/sdk already pulls in transitively, so it works standalone.
 *
 * Mirrors handshake.ts's own logic and defaults (DEFAULT_API_URL, the
 * `purpose: 'handshake-check'` claim check, no issuer check) exactly, just
 * against the Web Request/Response API instead of an Express Router.
 */
const HANDSHAKE_SDK_VERSION = "0.0.7"; // matches the @mythos-work/sdk version this app depends on
const handshakeJwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function runHandshake(lt: string | null): Promise<HandlerResult> {
  if (!lt) {
    return { status: 401, body: { error: "Missing launch token" } };
  }

  const apiUrl = process.env.MYTHOS_API_URL!;
  let jwks = handshakeJwksCache.get(apiUrl);
  if (!jwks) {
    // createRemoteJWKSet caches the key set itself and automatically
    // re-fetches on an unrecognized `kid`, replicating the SDK's
    // getKeySet()/getKeySetWithKidFallback() pair without needing its
    // unexported jwks-cache module.
    jwks = createRemoteJWKSet(new URL("/.well-known/jwks.json", apiUrl));
    handshakeJwksCache.set(apiUrl, jwks);
  }

  try {
    const { payload } = await jwtVerify(lt, jwks, { algorithms: ["ES256"] });
    if (payload["purpose"] !== "handshake-check") {
      throw new errors.JWTClaimValidationFailed(
        "Token purpose is not handshake-check",
        payload,
        "purpose",
        "check",
      );
    }
  } catch (err) {
    if (err instanceof errors.JOSEError) {
      return { status: 401, body: { error: "Invalid launch token" } };
    }
    return { status: 503, body: { error: "Service unavailable" } };
  }

  return { status: 200, body: { ok: true, sdk_version: HANDSHAKE_SDK_VERSION } };
}
