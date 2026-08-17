import { PageContainer } from "@/components/shared/page-header";
import {
  CardSkeleton,
  MetricRowSkeleton,
  PageHeaderSkeleton,
  Skeleton,
  TableSkeleton,
} from "@/components/shared/skeletons";

export default function LeadsLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton action />
      {/* Group upload tiles */}
      <CardSkeleton>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      </CardSkeleton>
      <MetricRowSkeleton count={4} />
      <TableSkeleton rows={8} />
    </PageContainer>
  );
}
