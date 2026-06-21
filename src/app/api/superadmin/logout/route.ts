import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SA_COOKIE } from "@/lib/superadmin";

export const dynamic = "force-dynamic";

export async function POST() {
  const store = await cookies();
  store.delete(SA_COOKIE);
  return NextResponse.json({ ok: true });
}
