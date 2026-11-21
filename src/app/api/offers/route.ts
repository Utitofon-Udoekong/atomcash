import { NextResponse } from "next/server";
import { listOffers, openOffer, readOffer, releaseOffer, takeOffer, type OpenInput } from "@/lib/offer-store";

export const dynamic = "force-dynamic";

interface OpenBody extends OpenInput {
  op: "open";
}

interface TakeBody {
  op: "take";
  id: string;
  takerRefundLock: string;
  takerPayoutLock: string;
}

interface ReleaseBody {
  op: "release";
  id: string;
}

type Body = OpenBody | TakeBody | ReleaseBody;

export async function GET(request: Request): Promise<NextResponse> {
  const id = new URL(request.url).searchParams.get("id");
  if (id === null) return NextResponse.json({ offers: listOffers() });
  const offer = readOffer(id);
  if (offer === undefined) return NextResponse.json({ error: "missing" }, { status: 404 });
  return NextResponse.json(offer);
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "json" }, { status: 400 });
  }
  try {
    switch (body.op) {
      case "open":
        return NextResponse.json(openOffer(body));
      case "take":
        return NextResponse.json(await takeOffer(body.id, body.takerRefundLock, body.takerPayoutLock));
      case "release":
        await releaseOffer(body.id);
        return NextResponse.json({ ok: true });
      default: {
        const unreachable: never = body;
        return NextResponse.json({ error: "op", unreachable }, { status: 400 });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "rejected";
    const status = message === "missing" ? 404 : message === "taken" ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
