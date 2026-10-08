import { adminHandler } from "@/lib/server/admin";
import { body, HttpError } from "@/lib/server/http";
import { settingsInput } from "@/lib/validation";
import { db, transaction } from "@/lib/server/db";
import { envSettings } from "@/lib/server/config";
import { audit } from "@/lib/server/campaigns";
export const POST = adminHandler(async (r, admin) => {
  const v = settingsInput.parse(await body(r));
  return transaction(async (c) => {
    const { rows } = await c.query(
      "SELECT config FROM settings WHERE id=true FOR UPDATE",
    );
    const previous = { ...envSettings(), ...rows[0].config };
    if (previous.mint && previous.mint !== v.mint) {
      const activity = await c.query(
        "SELECT id FROM creator_fee_events LIMIT 1",
      );
      if (activity.rows.length)
        throw new HttpError(
          409,
          "Changing a tracked mint requires a separately reviewed migration",
        );
    }
    if (previous.creator && previous.creator !== v.creator) {
      const activity = await c.query(
        "SELECT id FROM creator_fee_events LIMIT 1",
      );
      if (activity.rows.length)
        throw new HttpError(
          409,
          "Changing a tracked creator requires a separately reviewed migration",
        );
    }
    if (previous.treasury && previous.treasury !== v.treasury) {
      const ledger = await c.query(
        "SELECT id FROM treasury_transactions LIMIT 1",
      );
      if (ledger.rows.length)
        throw new HttpError(
          409,
          "Changing a funded treasury requires a separately reviewed migration",
        );
    }
    await c.query("UPDATE settings SET config=$1 WHERE id=true", [
      JSON.stringify(v),
    ]);
    await audit(admin.id, "SETTINGS_UPDATE", "settings", v, c);
    return { saved: true };
  });
});
