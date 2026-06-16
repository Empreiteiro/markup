import { ScreenDetail } from "@/components/screen-detail";

export default async function ScreenPage({
  params,
}: {
  params: Promise<{ id: string; screenId: string }>;
}) {
  const { id, screenId } = await params;
  return <ScreenDetail projectId={id} screenId={screenId} />;
}
