import { TagLandingPage } from "@/components/tag-landing-page";

export default async function PestDiseasePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <TagLandingPage kind="pest" slug={slug} />;
}
