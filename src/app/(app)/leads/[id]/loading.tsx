import { PageContainer } from "@/components/shared/page-header";
import { CardSkeleton, Skeleton } from "@/components/shared/skeletons";

export default function LeadRecordLoading() {
  return (
    <PageContainer className="max-w-4xl">
      <div aria-busy="true" className="space-y-2">
        <span role="status" className="sr-only">
          Loading…
        </span>
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-36" />
      </div>
      <Skeleton className="h-9 w-72 max-w-full rounded-xl" />
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </PageContainer>
  );
}
