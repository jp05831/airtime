import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json(
    {
      error:
        "Public single-token treasury tracking has been retired. Use the creator dashboard for campaign billing.",
    },
    { status: 410 },
  );
}
