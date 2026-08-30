import { PageContainer } from "@/components/shared/page-header";
import { CardSkeleton, PageHeaderSkeleton } from "@/components/shared/skeletons";

/** The archive awaits its first search before it can render a single row. */
export default function RecordingsLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton action />
      <CardSkeleton className="min-h-[520px]" />
    </PageContainer>
  );
}
