import { PageContainer } from "@/components/shared/page-header";
import {
  CardSkeleton,
  PageHeaderSkeleton,
  Skeleton,
} from "@/components/shared/skeletons";

export default function DialerLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton action />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Queue rail */}
        <CardSkeleton className="lg:col-span-3">
          <div className="space-y-3">
            <Skeleton className="h-5 w-24" />
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        </CardSkeleton>
        {/* Main call stage */}
        <CardSkeleton className="lg:col-span-5 lg:min-h-[640px]">
          <div className="flex h-full flex-col items-center justify-center gap-4 py-16">
            <Skeleton className="h-24 w-24 rounded-full" />
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="mt-6 h-12 w-48 rounded-xl" />
          </div>
        </CardSkeleton>
        {/* Qualify / side panel */}
        <CardSkeleton className="lg:col-span-4">
          <div className="space-y-3">
            <Skeleton className="h-5 w-32" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-xl" />
            ))}
          </div>
        </CardSkeleton>
      </div>
    </PageContainer>
  );
}
