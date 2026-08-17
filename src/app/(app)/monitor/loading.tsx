import { PageContainer } from "@/components/shared/page-header";
import {
  CardSkeleton,
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/components/shared/skeletons";

export default function MonitorLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton action />
      {/* Live call sections — AI and human */}
      <TableSkeleton rows={3} />
      <TableSkeleton rows={3} />
      <CardSkeleton className="min-h-[160px]" />
    </PageContainer>
  );
}
