import {
  CardSkeleton,
  MetricRowSkeleton,
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/components/shared/skeletons";

/**
 * The Console route awaits its superadmin check before rendering anything, and
 * the console itself then fetches after mount. This covers the first gap; the
 * second is handled inside super-console.tsx, which used to replace its whole
 * <main> with a centred spinner.
 */
export default function ConsoleLoading() {
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeaderSkeleton />
      <MetricRowSkeleton count={4} />
      <CardSkeleton>
        <TableSkeleton rows={6} />
      </CardSkeleton>
    </div>
  );
}
