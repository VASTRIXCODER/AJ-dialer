import { PageContainer } from "@/components/shared/page-header";
import {
  CardSkeleton,
  PageHeaderSkeleton,
  Skeleton,
  TableSkeleton,
} from "@/components/shared/skeletons";

export default function AssignmentsLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton action />
      <CardSkeleton>
        <div className="space-y-3">
          <Skeleton className="h-5 w-44 max-w-[60%]" />
          <Skeleton className="h-3.5 w-72 max-w-[85%]" />
        </div>
      </CardSkeleton>
      <TableSkeleton rows={6} />
    </PageContainer>
  );
}
