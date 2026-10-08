import { handle, rateLimit } from "@/lib/server/http";
import { platformConfig } from "@/lib/platform/config";
export const GET = handle(async (r) => {
  await rateLimit("public-platform:" + r.headers.get("x-forwarded-for"), 60);
  const c = platformConfig();
  return {
    minimumCents: c.minimumCents.toString(),
    serviceFeeCents: c.serviceFeeCents.toString(),
    totalCents: c.totalCents.toString(),
    paymentConfigured: !!c.paymentWallet,
    walletAuthConfigured: !!process.env.DATABASE_URL,
    uploadsConfigured: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}, false);
