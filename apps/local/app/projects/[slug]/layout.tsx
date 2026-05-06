import { ProjectLayoutClient } from "./ProjectLayoutClient";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return <ProjectLayoutClient slug={slug}>{children}</ProjectLayoutClient>;
}
