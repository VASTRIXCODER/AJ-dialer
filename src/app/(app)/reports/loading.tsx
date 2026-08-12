import { PageContainer } from "@/components/shared/page-header";
import {
  CardSkeleton,
  MetricRowSkeleton,
  PageHeaderSkeleton,
} from "@/components/shared/skeletons";

export default function ReportsLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton action />
      <MetricRowSkeleton count={5} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CardSkeleton className="min-h-[260px]" />
        <CardSkeleton className="min-h-[260px]" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CardSkeleton className="min-h-[300px] lg:col-span-2" />
        <CardSkeleton className="min-h-[300px]" />
      </div>
    </PageContainer>
  );
}
