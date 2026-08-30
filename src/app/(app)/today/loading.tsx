import { PageContainer } from "@/components/shared/page-header";
import {
  CardSkeleton,
  MetricRowSkeleton,
  PageHeaderSkeleton,
} from "@/components/shared/skeletons";

/** My Day awaits getMyDay — the whole page, including the "who next" card. */
export default function TodayLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton action />
      <CardSkeleton className="min-h-[140px]" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CardSkeleton className="min-h-[260px]" />
        <CardSkeleton className="min-h-[260px]" />
      </div>
      <MetricRowSkeleton count={4} />
    </PageContainer>
  );
}
