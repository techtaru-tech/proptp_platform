import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/layout/Sidebar';
import { Header } from '../components/layout/Header';
import { getDisplaySettings } from '../services/settingsService';
import { setMoneyDisplay } from '../utils/format';

export function AdminLayout() {
  // How money is shown (rupees, or points) is read once, before any page draws an amount.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    getDisplaySettings().then(setMoneyDisplay).catch(() => undefined).finally(() => live && setReady(true));
    return () => { live = false; };
  }, []);
  return (
    <div className="flex min-h-screen bg-surface-subtle">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6">
          {ready ? <Outlet /> : null}
        </main>
      </div>
    </div>
  );
}
