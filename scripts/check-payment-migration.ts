import { verifyPaymentSchema } from "../lib/server/payment-schema";
import { db } from "../lib/server/db";
// Hold the existing production deployment if its payment registry migration
// has not been applied. Builds never migrate a remote database automatically.
async function main() {
  if (process.env.VERCEL_ENV !== "production") return;
  const pool = db();
  try {
    await verifyPaymentSchema(pool);
    console.log("Production payment registry migration verified.");
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Production deployment held: apply migration 008_payment_smoke_test.sql, then redeploy. Verify DATABASE_URL and DATABASE_CA_CERT_BASE64.",
  );
  process.exitCode = 1;
});
