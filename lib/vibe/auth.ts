import { vibeConfig } from "./config";
import { exactJSON } from "./money";
export type Transport = typeof fetch;
// Reviewed scopes for AIRTIME's private, single-account client-credentials app.
export const VIBE_OAUTH_SCOPES = [
  "advertisers:read",
  "audiences:read",
  "audiences:write",
  "campaigns:read",
  "campaigns:write",
  "campaigns:publish",
  "creatives:read",
  "creatives:write",
  "reporting:read",
  "billing:read",
] as const;
export class VibeAuthProvider {
  private token: string | null = null;
  private expires = 0;
  private pending: Promise<string> | null = null;
  constructor(private transport: Transport = fetch) {}
  invalidate() {
    this.token = null;
    this.expires = 0;
  }
  async accessToken(force = false): Promise<string> {
    if (force) this.invalidate();
    if (this.token && this.expires > Date.now() + 30000) return this.token;
    if (this.pending) return this.pending;
    this.pending = this.obtain().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  private async obtain(): Promise<string> {
    if (typeof window !== "undefined")
      throw Error("Vibe authentication is server-only");
    const config = vibeConfig(),
      id = process.env.VIBE_CLIENT_ID,
      secret = process.env.VIBE_CLIENT_SECRET;
    if (id && secret) {
      const response = await this.transport(config.base + "/oauth2/token", {
        method: "POST",
        headers: {
          Authorization:
            "Basic " + Buffer.from(id + ":" + secret).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: VIBE_OAUTH_SCOPES.join(" "),
        }),
        signal: AbortSignal.timeout(12000),
        redirect: "error",
      });
      if (!response.ok)
        throw Error(
          "Vibe OAuth authentication failed; rotate/review the replacement credential",
        );
      const data = exactJSON(await response.text()),
        ttl = Number(data.expires_in);
      if (
        typeof data.access_token !== "string" ||
        data.token_type?.toLowerCase() !== "bearer" ||
        !Number.isSafeInteger(ttl) ||
        ttl < 60 ||
        ttl > 86400
      )
        throw Error("Invalid Vibe token response");
      this.token = data.access_token;
      this.expires = Date.now() + ttl * 1000;
      return data.access_token as string;
    }
    const token = process.env.VIBE_ACCESS_TOKEN,
      expires = Date.parse(process.env.VIBE_ACCESS_TOKEN_EXPIRES_AT || "");
    if (!token || !Number.isFinite(expires) || expires <= Date.now() + 30000)
      throw Error(
        "Replacement Vibe OAuth client or explicitly expiring access token required",
      );
    this.token = token;
    this.expires = expires;
    return token;
  }
}
