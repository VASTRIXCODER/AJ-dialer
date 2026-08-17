import { PageContainer } from "@/components/shared/page-header";
import {
  CardGridSkeleton,
  MetricRowSkeleton,
  PageHeaderSkeleton,
} from "@/components/shared/skeletons";

export default function CampaignsLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton action />
      <MetricRowSkeleton count={3} />
      <CardGridSkeleton cards={6} cols={3} />
    </PageContainer>
  );
}
