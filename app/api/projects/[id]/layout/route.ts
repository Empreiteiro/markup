import { NextResponse } from "next/server";
import { updateScreenPositions } from "@/src/db/screens";

export const dynamic = "force-dynamic";

interface PosInput {
  id: string;
  x: number;
  y: number;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { positions?: unknown };
  if (!Array.isArray(body.positions)) {
    return NextResponse.json({ error: "Invalid positions" }, { status: 400 });
  }
  const positions: PosInput[] = body.positions
    .map((p) => p as Record<string, unknown>)
    .filter(
      (p) =>
        typeof p.id === "string" &&
        Number.isFinite(Number(p.x)) &&
        Number.isFinite(Number(p.y)),
    )
    .map((p) => ({ id: p.id as string, x: Number(p.x), y: Number(p.y) }));
  updateScreenPositions(positions);
  return NextResponse.json({ ok: true, count: positions.length });
}
