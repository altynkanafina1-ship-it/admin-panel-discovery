import { Route, Routes, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import LoginScreen from "@/components/LoginScreen";
import Overview from "@/pages/Overview";
import Players from "@/pages/Players";
import PlayerDetail from "@/pages/PlayerDetail";
import Matches from "@/pages/Matches";
import MatchDetail from "@/pages/MatchDetail";
import Economy from "@/pages/Economy";
import SystemHealth from "@/pages/SystemHealth";
import Roadmap from "@/pages/Roadmap";
import Insights from "@/pages/Insights";
import { fetchSession, type AdminSession } from "@/services/auth";

export default function App() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount: probe session via HttpOnly cookie (FIND-006).
  useEffect(() => {
    let alive = true;
    fetchSession().then((s) => {
      if (!alive) return;
      setSession(s);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  // Periodically refresh session presence (catches expiry / revocation; FIND-044).
  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => { fetchSession().then(setSession); }, 60_000);
    return () => clearInterval(t);
  }, [session]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-ink-400 text-sm mono">
        loading session…
      </div>
    );
  }

  if (!session) {
    return <LoginScreen onSuccess={(s) => setSession(s)} />;
  }

  return (
    <Layout session={session} onLogout={() => setSession(null)}>
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<Overview />} />
        <Route path="/players" element={<Players />} />
        <Route path="/players/:id" element={<PlayerDetail />} />
        <Route path="/matches" element={<Matches />} />
        <Route path="/matches/:id" element={<MatchDetail />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/economy" element={<Economy />} />
        <Route path="/health" element={<SystemHealth />} />
        <Route path="/roadmap" element={<Roadmap />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </Layout>
  );
}
