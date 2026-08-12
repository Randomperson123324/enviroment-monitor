import Dashboard from '@/components/Dashboard';

export const metadata = { title: 'ตั้งค่า · ENV Monitor' };

/**
 * The same dashboard, with the assistant open on its settings face. Settings are
 * not a place of their own any more — they are one of the two things that panel
 * shows — but the URL still works, so a link or a bookmark lands where it says.
 */
export default function Page() {
  return <Dashboard initialPanel="settings" />;
}
