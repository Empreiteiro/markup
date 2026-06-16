import { NextResponse } from "next/server";
import { createAnnotation, listAnnotations } from "@/src/db/annotations";
import { getScreen } from "@/src/db/screens";
import { CreateAnnotationSchema } from "@/src/types/schemas";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  return NextResponse.json(listAnnotations(id));
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!getScreen(id)) {
    return NextResponse.json({ error: "Screen not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = CreateAnnotationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const annotation = createAnnotation(id, parsed.data);
  return NextResponse.json(annotation, { status: 201 });
}
