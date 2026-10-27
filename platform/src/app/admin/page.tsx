import { redirect } from 'next/navigation';

/**
 * `/admin` → Analytics. The admin portal now lands on the Analytics dashboard (the former
 * Masters-overview landing was removed); a direct `/admin` hit is redirected server-side so
 * every entry point agrees. Each master is still reachable from the left nav (Masters group).
 */
export default function AdminIndex() {
  redirect('/admin/analytics');
}
