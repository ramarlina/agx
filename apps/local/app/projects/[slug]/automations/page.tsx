import { ProjectAutomationsPageClient } from "./ProjectAutomationsPageClient";

export default async function ProjectAutomationsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return <ProjectAutomationsPageClient slug={slug} />;
}
