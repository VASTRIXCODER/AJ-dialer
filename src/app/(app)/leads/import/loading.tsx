import { PageContainer } from "@/components/shared/page-header";
import {
  CardSkeleton,
  PageHeaderSkeleton,
  Skeleton,
} from "@/components/shared/skeletons";

export default function ImportStudioLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton />
      {/* Step rail */}
      <div className="flex gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-20 rounded-lg" />
        ))}
      </div>
      {/* Dropzone */}
      <CardSkeleton>
        <Skeleton className="h-48 w-full rounded-2xl" />
      </CardSkeleton>
      {/* Recent jobs */}
      <CardSkeleton>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-lg" />
          ))}
        </div>
      </CardSkeleton>
    </PageContainer>
  );
}
