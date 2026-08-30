import { PageContainer } from "@/components/shared/page-header";
import { CardSkeleton, PageHeaderSkeleton } from "@/components/shared/skeletons";

/** The pipeline board awaits getScope + the board read before rendering. */
export default function CrmLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton action />
      <CardSkeleton className="min-h-[420px]" />
      <CardSkeleton className="min-h-[280px]" />
    </PageContainer>
  );
}
