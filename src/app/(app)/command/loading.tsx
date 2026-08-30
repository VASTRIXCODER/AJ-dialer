import { PageContainer } from "@/components/shared/page-header";
import {
  CardSkeleton,
  MetricRowSkeleton,
  PageHeaderSkeleton,
  Skeleton,
} from "@/components/shared/skeletons";

/** Command Center: six counts across the top, then the work panels. */
export default function CommandLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton />
      <MetricRowSkeleton count={6} />
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardSkeleton key={i}>
            <div className="space-y-2.5">
              {Array.from({ length: 3 }).map((_, r) => (
                <Skeleton key={r} className="h-12 w-full rounded-xl" />
              ))}
            </div>
          </CardSkeleton>
        ))}
      </div>
    </PageContainer>
  );
}
