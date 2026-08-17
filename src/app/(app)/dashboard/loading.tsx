import { PageContainer } from "@/components/shared/page-header";
import {
  CardSkeleton,
  MetricRowSkeleton,
  PageHeaderSkeleton,
} from "@/components/shared/skeletons";

export default function DashboardLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton action />
      <MetricRowSkeleton count={4} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CardSkeleton className="min-h-[320px] lg:col-span-2" />
        <CardSkeleton className="min-h-[320px]" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CardSkeleton className="min-h-[280px] lg:col-span-2" />
        <CardSkeleton className="min-h-[280px]" />
      </div>
    </PageContainer>
  );
}
