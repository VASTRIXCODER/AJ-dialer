import { PageContainer } from "@/components/shared/page-header";
import {
  CardSkeleton,
  PageHeaderSkeleton,
} from "@/components/shared/skeletons";

export default function SettingsLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton />
      <CardSkeleton className="min-h-[200px]" />
      <CardSkeleton className="min-h-[200px]" />
      <CardSkeleton className="min-h-[200px]" />
    </PageContainer>
  );
}
