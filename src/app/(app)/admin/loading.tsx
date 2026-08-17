import { PageContainer } from "@/components/shared/page-header";
import {
  CardSkeleton,
  PageHeaderSkeleton,
  Skeleton,
} from "@/components/shared/skeletons";

export default function AdminLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton />
      {/* Tab rail */}
      <Skeleton className="h-10 w-full max-w-md rounded-xl" />
      <CardSkeleton className="min-h-[220px]" />
      <CardSkeleton className="min-h-[220px]" />
    </PageContainer>
  );
}
