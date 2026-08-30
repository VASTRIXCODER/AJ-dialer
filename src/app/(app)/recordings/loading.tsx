import { PageContainer } from "@/components/shared/page-header";
import {
  CardSkeleton,
  PageHeaderSkeleton,
  Skeleton,
  TableSkeleton,
} from "@/components/shared/skeletons";

/** The call archive: a filter bar over a long searchable list. */
export default function RecordingsLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton />
      <CardSkeleton>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-10 w-full max-w-md rounded-xl" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-32 rounded-xl" />
          ))}
        </div>
      </CardSkeleton>
      <TableSkeleton rows={10} />
    </PageContainer>
  );
}
