import { TeamsPageClient } from "./TeamsPageClient";

export default async function TeamsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return <TeamsPageClient slug={slug} />;
}
