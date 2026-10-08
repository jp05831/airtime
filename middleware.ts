import { NextRequest, NextResponse } from "next/server";
export function middleware(r: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' ${process.env.NODE_ENV !== "production" ? "'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' https:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';`;
  const headers = new Headers(r.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
