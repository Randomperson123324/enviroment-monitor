import SettingsPage from '@/components/SettingsPage';

export const metadata = { title: 'ตั้งค่านักพัฒนา · ENV Monitor' };

export default function Page() {
  return <SettingsPage scope="dev" />;
}
