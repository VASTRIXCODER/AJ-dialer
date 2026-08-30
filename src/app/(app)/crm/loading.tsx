import { PageContainer } from "@/components/shared/page-header";
import { CardGridSkeleton, PageHeaderSkeleton } from "@/components/shared/skeletons";

/**
 * The CRM's own Suspense boundary used `fallback={null}`, which is the same as
 * having none: the route awaited its data with nothing on screen.
 */
export default function CrmLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton action />
      <CardGridSkeleton cards={6} />
    </PageContainer>
  );
}
