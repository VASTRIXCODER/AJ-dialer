import { PageContainer } from "@/components/shared/page-header";
import {
  CardSkeleton,
  MetricRowSkeleton,
  PageHeaderSkeleton,
} from "@/components/shared/skeletons";

/** Mirrors the real page's shape: today strip, automation, leaks, floor. */
export default function PipelineLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton action />
      <MetricRowSkeleton count={4} />
      <CardSkeleton className="min-h-[200px]" />
      <CardSkeleton className="min-h-[220px]" />
      <CardSkeleton className="min-h-[240px]" />
    </PageContainer>
  );
}
