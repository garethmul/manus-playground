import { NextRequest, NextResponse } from "next/server";

const SITE_PASSWORD = "Eden2026!";
const COOKIE_NAME = "readium_auth";
const COOKIE_VALUE = "authenticated";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { password } = body;

  if (password === SITE_PASSWORD) {
    const response = NextResponse.json({ success: true });
    response.cookies.set(COOKIE_NAME, COOKIE_VALUE, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });
    return response;
  }

  return NextResponse.json({ success: false, error: "Incorrect password" }, { status: 401 });
}
