import { NextResponse } from "next/server";
import {
  deleteScreen,
  getScreen,
  listElements,
  updateScreenPosition,
} from "@/src/db/screens";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const screen = getScreen(id);
  if (!screen) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ screen, elements: listElements(id) });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!getScreen(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    posX?: unknown;
    posY?: unknown;
  };
  const x = Number(body.posX);
  const y = Number(body.posY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return NextResponse.json({ error: "Invalid posX/posY" }, { status: 400 });
  }
  updateScreenPosition(id, x, y);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!deleteScreen(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
