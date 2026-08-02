import { Link, NavLink, Outlet } from "react-router-dom";
import { CalendarDays, Sparkles, Library, ShieldCheck } from "lucide-react";
import { badgeClass, buttonClass, cx } from "@ops-forward/keel";
import { ThemeToggle } from "./ThemeToggle";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { useSession } from "../hooks/useSession";
import { useSignOut } from "../hooks/useAuth";

const NAV = [
  { to: "/plan", label: "Plan", icon: CalendarDays },
  { to: "/cadences", label: "Cadences", icon: Sparkles },
  { to: "/library", label: "Library", icon: Library },
  { to: "/admin", label: "Admin", icon: ShieldCheck },
];

export function Layout() {
  const { data: session } = useSession();
  const signOut = useSignOut();

  return (
    <div className="min-h-screen flex flex-col">
      <header
        className="flex items-center justify-between gap-4 px-6 py-4 border-b"
        style={{ borderColor: "var(--of-border-line)" }}
      >
        <div className="flex items-center gap-8">
          <Link to="/" className="font-semibold text-lg" style={{ color: "var(--of-fg-default)" }}>
            Ritual Builder
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cx(
                    "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    isActive ? "of-nav-link--active" : "of-nav-link",
                  )
                }
                style={({ isActive }) => ({
                  color: isActive ? "var(--of-fg-brand)" : "var(--of-fg-muted)",
                  background: isActive ? "var(--of-bg-brand-subtle)" : "transparent",
                })}
              >
                <Icon size={20} strokeWidth={1.75} className="!w-4 !h-4" />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {session?.team && (
            <span className={badgeClass({ variant: "default" })}>{session.team.name}</span>
          )}
          {session?.authEnabled &&
            (session.user?.signedIn ? (
              <div className="flex items-center gap-2">
                {session.user.avatarUrl && (
                  <img src={session.user.avatarUrl} alt="" className="w-6 h-6" style={{ borderRadius: "var(--of-radius-pill)" }} />
                )}
                <span className="text-sm" style={{ color: "var(--of-fg-muted)" }}>{session.user.name}</span>
                <button className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => signOut.mutate()} disabled={signOut.isPending}>
                  Sign out
                </button>
              </div>
            ) : (
              <GoogleSignInButton />
            ))}
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
