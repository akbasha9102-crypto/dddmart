/** Minimal route-level loading skeleton shown while this page's data streams in. */
export default function Loading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-pulse rounded-full border-4 border-brand-200 border-t-brand-600" />
    </div>
  );
}
