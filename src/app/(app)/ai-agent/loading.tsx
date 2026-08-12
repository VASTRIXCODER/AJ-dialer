import { PageContainer } from "@/components/shared/page-header";
import {
  CardSkeleton,
  PageHeaderSkeleton,
  Skeleton,
} from "@/components/shared/skeletons";

export default function AIAgentLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton action />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CardSkeleton className="min-h-[280px] lg:col-span-2" />
        <CardSkeleton className="min-h-[280px]" />
      </div>
      {/* Recent AI call cards */}
      <div
        aria-hidden="true"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <CardSkeleton key={i}>
            <div className="space-y-2.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
          </CardSkeleton>
        ))}
      </div>
    </PageContainer>
  );
}
