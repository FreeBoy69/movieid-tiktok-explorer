import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Activity, ArrowLeft, BarChart3, CreditCard, Gauge, LifeBuoy, LogOut, Menu, Moon, Server, ShieldCheck, SlidersHorizontal, Sun, Users, X,
} from "lucide-react";
import { AdminApiError, adminFetch, type AdminIdentity } from "./api";
import { Avatar, Button, cx, Loading } from "./ui";
import { OverviewPage } from "./pages/OverviewPage";
import { UsersPage } from "./pages/UsersPage";
import { BillingPage } from "./pages/BillingPage";
import { UsagePage } from "./pages/UsagePage";
import { ActivityPage } from "./pages/ActivityPage";
import { SupportPage } from "./pages/SupportPage";
import { GovernancePage } from "./pages/GovernancePage";
import { TeamPage } from "./pages/TeamPage";
import { SystemPage } from "./pages/SystemPage";
import "./admin.css";

type Theme = "light" | "dark";
export type AdminRoute = { page: string; id: string };
export type Navigate = (path: string, options?: { replace?: boolean }) => void;
export type PageProps = { admin: AdminIdentity; route: AdminRoute; navigate: Navigate };

const NAV: Array<{ group: string; items: Array<{ page: string; label: string; icon: ReactNode }> }> = [
  { group: "Operate", items: [
    { page: "overview", label: "Overview", icon: <Gauge size={17} /> },
    { page: "users", label: "Users", icon: <Users size={17} /> },
    { page: "activity", label: "Activity", icon: <Activity size={17} /> },
    { page: "support", label: "Support", icon: <LifeBuoy size={17} /> },
  ] },
  { group: "Revenue", items: [
    { page: "billing", label: "Billing", icon: <CreditCard size={17} /> },
    { page: "usage", label: "Token usage", icon: <BarChart3 size={17} /> },
  ] },
  { group: "Control", items: [
    { page: "governance", label: "Governance", icon: <SlidersHorizontal size={17} /> },
    { page: "team", label: "Team & audit", icon: <ShieldCheck size={17} /> },
    { page: "system", label: "System", icon: <Server size={17} /> },
  ] },
];
const PAGES: Record<string, (props: PageProps) => ReactNode> = {
  overview: OverviewPage, users: UsersPage, activity: ActivityPage, support: SupportPage,
  billing: BillingPage, usage: UsagePage, governance: GovernancePage, team: TeamPage, system: SystemPage,
};

function readRoute(): AdminRoute {
  const [, , page = "", id = ""] = window.location.pathname.split("/");
  return { page: page || "overview", id: decodeURIComponent(id) };
}

export default function AdminApp() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return window.localStorage.getItem("autoyt-theme") === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  const [route, setRoute] = useState<AdminRoute>(readRoute);
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);
  const [gate, setGate] = useState<{ state: "loading" | "signin" | "denied" | "error" | "ready"; message?: string; email?: string }>({ state: "loading" });
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    document.title = "AutoYT Admin";
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("autoyt-theme", theme);
    } catch {}
  }, [theme]);

  const navigate = useCallback<Navigate>((path, options = {}) => {
    if (options.replace) window.history.replaceState({}, "", path);
    else window.history.pushState({}, "", path);
    setRoute(readRoute());
    setNavOpen(false);
  }, []);
  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const loadIdentity = useCallback(async () => {
    setGate({ state: "loading" });
    try {
      const { admin: identity } = await adminFetch<{ admin: AdminIdentity }>("/api/admin/me");
      setAdmin(identity);
      setGate({ state: "ready" });
      if (window.location.pathname.startsWith("/admin/login")) navigate("/admin", { replace: true });
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 401) setGate({ state: "signin" });
      else if (error instanceof AdminApiError && error.code === "not_admin") setGate({ state: "denied", message: error.message });
      else setGate({ state: "error", message: error instanceof Error ? error.message : "Couldn't reach the server." });
    }
  }, [navigate]);
  useEffect(() => {
    void loadIdentity();
  }, [loadIdentity]);

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setAdmin(null);
    setGate({ state: "signin" });
    navigate("/admin/login", { replace: true });
  };

  if (gate.state !== "ready" || !admin) {
    return (
      <div className="adm adm-gate app-backdrop" data-theme={theme}>
        <AdminLogin theme={theme} gate={gate} onRetry={loadIdentity} onSwitch={signOut} />
      </div>
    );
  }

  const Current = PAGES[route.page] || OverviewPage;
  return (
    <div className="adm" data-theme={theme}>
      <div className="adm-topbar">
        <button type="button" className="adm-icon-btn" onClick={() => setNavOpen(true)} aria-label="Open navigation" aria-expanded={navOpen}><Menu size={19} /></button>
        <Brand theme={theme} />
      </div>
      {navOpen ? <div className="adm-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" /> : null}
      <aside className={cx("adm-sidebar", navOpen && "is-open")} aria-label="Admin navigation">
        <div className="adm-sidebar-head">
          <Brand theme={theme} />
          <button type="button" className="adm-icon-btn adm-sidebar-close" onClick={() => setNavOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        <nav className="adm-nav">
          {NAV.map((group) => (
            <div key={group.group} className="adm-nav-group">
              <span className="adm-nav-label">{group.group}</span>
              {group.items.map((item) => {
                const current = (PAGES[route.page] ? route.page : "overview") === item.page;
                return (
                  <a
                    key={item.page}
                    href={`/admin/${item.page === "overview" ? "" : item.page}`}
                    className={cx("adm-nav-item", current && "is-current")}
                    aria-current={current ? "page" : undefined}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                      event.preventDefault();
                      navigate(`/admin/${item.page === "overview" ? "" : item.page}`);
                    }}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </a>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="adm-sidebar-foot">
          <div className="adm-me">
            <Avatar src={admin.avatarUrl} name={admin.name || admin.email} size={32} />
            <span>
              <strong>{admin.name || admin.email}</strong>
              <small>{admin.role}</small>
            </span>
          </div>
          <div className="adm-sidebar-actions">
            <a className="adm-icon-btn" href="/" title="Back to AutoYT" aria-label="Back to AutoYT"><ArrowLeft size={17} /></a>
            <button type="button" className="adm-icon-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button type="button" className="adm-icon-btn" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>
          </div>
        </div>
      </aside>
      <main className="adm-main app-backdrop">
        <Current admin={admin} route={route} navigate={navigate} />
      </main>
    </div>
  );
}

function Brand({ theme }: { theme: Theme }) {
  return (
    <a className="adm-brand" href="/admin">
      <img src={theme === "dark" ? "/brand/autoyt-dark-horizontal.png" : "/brand/autoyt-light-horizontal.png"} alt="AutoYT" height={22} />
      <span className="adm-brand-tag">Admin</span>
    </a>
  );
}

function AdminLogin({ theme, gate, onRetry, onSwitch }: { theme: Theme; gate: { state: string; message?: string }; onRetry: () => void; onSwitch: () => void }) {
  const signIn = () => {
    window.location.href = `/api/auth/google?mode=signin&next=${encodeURIComponent("/admin")}`;
  };
  return (
    <main className="adm-login">
      <div className="adm-login-card">
        <img className="adm-login-logo" src={theme === "dark" ? "/brand/autoyt-dark-horizontal.png" : "/brand/autoyt-light-horizontal.png"} alt="AutoYT" height={26} />
        <h1>Admin console</h1>
        {gate.state === "loading" ? (
          <Loading label="Checking your access" />
        ) : gate.state === "denied" ? (
          <>
            <p className="adm-login-note is-warn">{gate.message} Ask an owner to add you on the Team page, or sign in with a different Google account.</p>
            <Button variant="primary" onClick={onSwitch}>Use a different account</Button>
          </>
        ) : gate.state === "error" ? (
          <>
            <p className="adm-login-note is-warn">{gate.message}</p>
            <Button onClick={onRetry}>Try again</Button>
          </>
        ) : (
          <>
            <p>Sign in with the Google account your team added as an admin.</p>
            <button type="button" className="adm-google" onClick={signIn}>
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
              </svg>
              Continue with Google
            </button>
            <small className="adm-login-foot">Every admin action is recorded in the audit log.</small>
          </>
        )}
      </div>
      <a className="adm-login-back" href="/"><ArrowLeft size={14} aria-hidden="true" /> Back to AutoYT</a>
    </main>
  );
}
