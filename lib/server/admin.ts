import { NextRequest } from "next/server";
import { handle, rateLimit } from "./http";
import { requireAdmin } from "./auth";
export function adminHandler(
  fn: (
    r: NextRequest,
    admin: { id: string; email: string },
  ) => Promise<unknown>,
  mutation = true,
) {
  return handle(async (r) => {
    const admin = await requireAdmin(r);
    await rateLimit("admin:" + admin.id, 60);
    return fn(r, admin);
  }, mutation);
}
