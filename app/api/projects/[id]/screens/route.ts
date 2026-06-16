import { NextResponse } from "next/server";
import { listScreenSummaries } from "@/src/db/screens";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  return NextResponse.json(listScreenSummaries(id));
}
