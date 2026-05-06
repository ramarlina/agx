import { ProjectPageClient } from "./ProjectPageClient";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return <ProjectPageClient slug={slug} />;
}
