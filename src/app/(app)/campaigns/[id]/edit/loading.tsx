import { PageContainer } from "@/components/shared/page-header";
import { CardSkeleton, PageHeaderSkeleton } from "@/components/shared/skeletons";

export default function CampaignEditLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton />
      <div className="space-y-4">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </PageContainer>
  );
}
