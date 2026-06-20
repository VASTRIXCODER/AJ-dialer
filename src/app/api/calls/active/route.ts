import { NextResponse } from "next/server";
import {
  connectHumanCall,
  endHumanCall,
  listActiveHumanCalls,
  startHumanCall,
} from "@/lib/human-call-store";

export const dynamic = "force-dynamic";

/** Live human (manual) call presence for the Live Monitor. */
export async function GET() {
  return NextResponse.json({ active: listActiveHumanCalls() });
}

export async function POST(req: Request) {
  const { action, id, leadName, city, phone } = (await req
    .json()
    .catch(() => ({}))) as {
    action?: "start" | "connect" | "end";
    id?: string;
    leadName?: string;
    city?: string;
    phone?: string;
  };

  if (!id || !action) {
    return NextResponse.json(
      { error: "id and action are required" },
      { status: 400 },
    );
  }

  if (action === "start") {
    startHumanCall({ id, leadName: leadName ?? "Manual call", city, phone });
  } else if (action === "connect") {
    connectHumanCall(id);
  } else {
    endHumanCall(id);
  }

  return NextResponse.json({ ok: true });
}
