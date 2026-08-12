import { PageContainer } from "@/components/shared/page-header";
import {
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/components/shared/skeletons";

export default function TeamStatusLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton />
      {/* Roster rows */}
      <TableSkeleton rows={8} />
    </PageContainer>
  );
}
