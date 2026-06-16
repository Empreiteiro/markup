import { NextResponse } from "next/server";
import { listEdges } from "@/src/db/edges";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  return NextResponse.json(listEdges(id));
}
