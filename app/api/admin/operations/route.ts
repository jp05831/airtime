import { adminHandler } from "@/lib/server/admin";
import { body } from "@/lib/server/http";
import { z } from "zod";
import { operationsState, adminOperation } from "@/lib/platform/operations";
export const GET = adminHandler(
  async (r) =>
    operationsState(
      z.coerce
        .number()
        .int()
        .min(1)
        .max(10000)
        .parse(r.nextUrl.searchParams.get("page") || 1),
    ),
  false,
);
export const POST = adminHandler(async (r, a) =>
  adminOperation(a.id, await body(r)),
);
