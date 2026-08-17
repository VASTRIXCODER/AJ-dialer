import { PageContainer } from "@/components/shared/page-header";
import {
  CardSkeleton,
  MetricRowSkeleton,
  PageHeaderSkeleton,
  Skeleton,
} from "@/components/shared/skeletons";

export default function AppointmentsLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton action />
      <MetricRowSkeleton count={4} />
      {/* Calendar / list board */}
      <CardSkeleton>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-9 w-56 rounded-xl" />
            <Skeleton className="h-9 w-36 rounded-xl" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </CardSkeleton>
    </PageContainer>
  );
}
