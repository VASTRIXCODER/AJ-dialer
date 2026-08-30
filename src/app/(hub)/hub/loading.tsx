import { CardGridSkeleton, Skeleton } from "@/components/shared/skeletons";

/**
 * The Hub awaits three queries — memberships, pending requests, superadmin —
 * before it can render, and had no skeleton, so signing in landed on a blank
 * page under an ambient field. The layout already supplies the ambient
 * background and the max-width column; this is only the content.
 */
export default function HubLoading() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <CardGridSkeleton cards={3} cols={3} />
    </div>
  );
}
