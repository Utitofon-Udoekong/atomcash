import { NextResponse } from "next/server";
import { loadMarket } from "@/lib/market";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await loadMarket());
  } catch (error) {
    const message = error instanceof Error ? error.message : "oracle";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
