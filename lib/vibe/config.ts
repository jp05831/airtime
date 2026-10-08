export function vibeConfig() {
  const base = process.env.VIBE_API_BASE_URL || "https://api.vibe.co";
  if (base !== "https://api.vibe.co")
    throw Error("Only the official Vibe API origin is allowed");
  const revision = process.env.VIBE_API_REVISION || "2026-06-01";
  if (revision !== "2026-06-01")
    throw Error("Vibe revision requires a reviewed adapter update");
  const accountId = process.env.VIBE_ACCOUNT_ID || "";
  if (accountId && !/^\d{1,15}$/.test(accountId))
    throw Error("Vibe account ID must be an integer");
  const enabled = (key: string) => {
    const value = process.env[key] || "false";
    if (!["true", "false"].includes(value))
      throw Error(`${key} must be true or false`);
    return value === "true";
  };
  const live = enabled("VIBE_LIVE_MODE");
  if (
    live &&
    !(process.env.VIBE_CLIENT_ID && process.env.VIBE_CLIENT_SECRET) &&
    !process.env.VIBE_ACCESS_TOKEN
  )
    throw Error("Live Vibe configuration is incomplete");
  if (live && !(process.env.VIBE_CLIENT_ID && process.env.VIBE_CLIENT_SECRET)) {
    const expires = Date.parse(process.env.VIBE_ACCESS_TOKEN_EXPIRES_AT || "");
    if (!Number.isFinite(expires) || expires <= Date.now() + 30000)
      throw Error("Static Vibe access token requires a future expiration");
  }
  return { base, revision, accountId, live };
}
export function activationGate() {
  return vibeConfig().live
    ? null
    : "Prelaunch/test mode: real publishing and activation are disabled";
}
