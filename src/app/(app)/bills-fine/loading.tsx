import { PageContainer } from "@/components/shared/page-header";
import {
  MetricRowSkeleton,
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/components/shared/skeletons";

export default function BillsFineLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton action />
      <MetricRowSkeleton count={4} />
      <TableSkeleton rows={8} />
    </PageContainer>
  );
}
