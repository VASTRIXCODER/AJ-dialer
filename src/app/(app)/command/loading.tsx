import { PageContainer } from "@/components/shared/page-header";
import {
  CardSkeleton,
  MetricRowSkeleton,
  PageHeaderSkeleton,
} from "@/components/shared/skeletons";

/**
 * Command Center awaits getCommandCenter before it returns anything, so without
 * this the nav click was a dead pause — on one of the four routes (of 23) that
 * had no skeleton at all.
 */
export default function CommandLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton />
      <MetricRowSkeleton count={6} />
      <CardSkeleton className="min-h-[180px]" />
      <CardSkeleton className="min-h-[240px]" />
      <CardSkeleton className="min-h-[260px]" />
    </PageContainer>
  );
}
