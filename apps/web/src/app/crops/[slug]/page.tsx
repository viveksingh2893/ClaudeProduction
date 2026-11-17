import { TagLandingPage } from "@/components/tag-landing-page";

export default async function CropPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <TagLandingPage kind="crop" slug={slug} />;
}
