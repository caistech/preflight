import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { Sidebar } from './sidebar';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Pending-reviews count for the sidebar badge. Uses service client because
  // the count is a global signal across the operator's queue and we don't
  // want to invalidate the cache on every project read.
  let pendingReviewCount = 0;
  if (user) {
    const db = createServiceClient();
    const { count } = await db
      .from('check_result_decisions')
      .select('id', { count: 'exact', head: true })
      .is('operator_review', null);
    pendingReviewCount = count ?? 0;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Sidebar email={user?.email ?? null} pendingReviewCount={pendingReviewCount} />
      {/* Reserve room for the fixed left rail on md+ */}
      <main className="md:pl-60">{children}</main>
    </div>
  );
}
