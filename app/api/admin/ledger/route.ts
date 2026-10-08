import { adminHandler } from "@/lib/server/admin";
import { HttpError } from "@/lib/server/http";
// Previous implementation is preserved in archive/treasury-routes.
export const POST = adminHandler(async () => {
  throw new HttpError(
    410,
    "Legacy treasury mutations are archived. Use creator campaign operations.",
  );
});
