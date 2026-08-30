import { PageContainer } from "@/components/shared/page-header";
import {
  CardSkeleton,
  MetricRowSkeleton,
  PageHeaderSkeleton,
  Skeleton,
} from "@/components/shared/skeletons";

/**
 * My Day awaits getMyDay() before it can render anything, and had no skeleton —
 * so a rep navigating here sat on the PREVIOUS screen, frozen, until the query
 * came back. This is the shape of what is coming: the four KPI tiles, then the
 * three work lists.
 */
export default function TodayLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton action />
      <MetricRowSkeleton count={4} />
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <CardSkeleton key={i}>
            <div className="space-y-2.5">
              {Array.from({ length: 4 }).map((_, r) => (
                <Skeleton key={r} className="h-12 w-full rounded-xl" />
              ))}
            </div>
          </CardSkeleton>
        ))}
      </div>
    </PageContainer>
  );
}
