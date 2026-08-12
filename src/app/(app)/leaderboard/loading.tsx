import { PageContainer } from "@/components/shared/page-header";
import {
  MetricRowSkeleton,
  PageHeaderSkeleton,
  Skeleton,
  TableSkeleton,
} from "@/components/shared/skeletons";

export default function LeaderboardLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton action />
      <MetricRowSkeleton count={4} />
      {/* Podium */}
      <div aria-hidden="true" className="mx-auto grid w-full max-w-2xl grid-cols-3 items-end gap-3">
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>
      <TableSkeleton rows={6} />
    </PageContainer>
  );
}
