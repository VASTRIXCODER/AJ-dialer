import { PageContainer } from "@/components/shared/page-header";
import {
  CardSkeleton,
  MetricRowSkeleton,
  PageHeaderSkeleton,
  Skeleton,
} from "@/components/shared/skeletons";

export default function CallbacksLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton action />
      <MetricRowSkeleton count={4} />
      {/* Overdue / due now / upcoming columns */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <CardSkeleton key={i} className="p-0 sm:p-0">
            <div className="flex items-center justify-between border-b border-border p-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>
            <div className="space-y-3 p-4">
              {Array.from({ length: 3 }).map((_, j) => (
                <Skeleton key={j} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          </CardSkeleton>
        ))}
      </div>
    </PageContainer>
  );
}
