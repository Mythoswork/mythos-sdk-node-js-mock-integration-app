export const SESSION_COOKIE_NAME = 'mythos_session';

// Matches the LLM identity token's own TTL (LLM_IDENTITY_TOKEN_TTL_SECONDS in the backend) --
// no point holding a cookie longer than the credential inside it stays valid.
export const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 60;
