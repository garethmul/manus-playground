import { NextRequest, NextResponse } from "next/server";

// Password protection middleware using a simple cookie-based approach
const SITE_PASSWORD = "Eden2026!";
const COOKIE_NAME = "readium_auth";
const COOKIE_VALUE = "authenticated";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow the login page and its API route to pass through
  if (pathname === "/login" || pathname === "/api/login") {
    return NextResponse.next();
  }

  // Check for auth cookie
  const authCookie = request.cookies.get(COOKIE_NAME);
  if (authCookie?.value === COOKIE_VALUE) {
    return NextResponse.next();
  }

  // Redirect to login page
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public files (images, fonts, locales)
     */
    "/((?!_next/static|_next/image|favicon.ico|images/|fonts/|locales/).*)",
  ],
};
