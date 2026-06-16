import { NextResponse } from "next/server";
import { writeExport } from "@/src/export/build";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const format = new URL(req.url).searchParams.get("format") ?? "md";
  const result = writeExport(id);
  if (!result) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (format === "json") {
    return new Response(JSON.stringify(result.doc, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="review-${id}.json"`,
        "cache-control": "no-store",
      },
    });
  }
  return new Response(result.md, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="review-${id}.md"`,
      "cache-control": "no-store",
    },
  });
}
