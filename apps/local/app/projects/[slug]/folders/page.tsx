import { FoldersPageClient } from "./FoldersPageClient";

export default async function FoldersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return <FoldersPageClient slug={slug} />;
}
