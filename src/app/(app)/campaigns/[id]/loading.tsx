import { PageContainer } from "@/components/shared/page-header";
import {
  CardSkeleton,
  MetricRowSkeleton,
  PageHeaderSkeleton,
  Skeleton,
} from "@/components/shared/skeletons";

export default function CampaignDetailLoading() {
  return (
    <PageContainer>
      {/* Back link */}
      <Skeleton className="h-4 w-28" />
      <PageHeaderSkeleton action />
      <MetricRowSkeleton count={6} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CardSkeleton className="min-h-[280px]" />
        <CardSkeleton className="min-h-[280px]" />
      </div>
    </PageContainer>
  );
}
