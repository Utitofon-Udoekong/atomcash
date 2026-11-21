import { NextResponse } from "next/server";
import { listTrades, recordTrade } from "@/lib/history";

export const dynamic = "force-dynamic";

interface RecordBody {
  pair: string;
  claim: string;
  payout?: string;
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ trades: listTrades() });
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: RecordBody;
  try {
    body = (await request.json()) as RecordBody;
  } catch {
    return NextResponse.json({ error: "json" }, { status: 400 });
  }
  try {
    return NextResponse.json(recordTrade(body));
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "rejected";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
