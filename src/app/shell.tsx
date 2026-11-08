import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Boxes, Braces, Check, FlaskConical, History, KeyRound, LogIn, LogOut, Monitor, Moon, Search, Server, Sun, User, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { signInWithPassword, signOut } from "@/api/auth";
import { infoQuery, whoamiQuery } from "@/api/queries";
import { RelativeTime } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Kbd } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

import { CommandPalette } from "./command-palette";
import { config } from "./config";
import { demoMode, demoUsers, exitDemo, resetDemo } from "./demo";
import { useSession } from "./session";
import { setTheme, useTheme, type Theme } from "./theme";

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-6 text-primary" aria-hidden>
      <rect x="6" y="1" width="9" height="9" rx="2" fill="currentColor" />
      <rect x="7" y="13" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="6" y="23" width="9" height="9" rx="2" fill="currentColor" />
      <rect x="17" y="23" width="9" height="9" rx="2" fill="currentColor" />
      <g transform="rotate(-60 24.5 10.5)" fill="currentColor">
        <path d="M18 6.5C22.55 3.312 26.45 8.986 31 6.5C26.45 9.454 22.55 4.247 18 6.5Z" />
        <path d="M16.5 10.5C22.1 6.55 26.9 13.625 32.5 10.5C26.9 14.175 22.1 7.65 16.5 10.5Z" />
        <path d="M18.5 14.5C22.7 11.51 26.3 16.83 30.5 14.5C26.3 17.27 22.7 12.39 18.5 14.5Z" />
      </g>
    </svg>
  );
}

function NavLink({ to, icon, children }: { to: string; icon: React.ReactNode; children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = to === "/" ? !["/registries", "/audit", "/access", "/search"].some((p) => pathname.startsWith(p)) : pathname.startsWith(to);
  return (
    <Link
      to={to}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-4",
        active && "bg-muted text-foreground",
      )}
    >
      {icon}
      <span className="hidden md:inline">{children}</span>
    </Link>
  );
}

const themeIcons: Record<Theme, React.ReactNode> = { light: <Sun />, dark: <Moon />, system: <Monitor /> };

function ThemeMenu() {
  const { theme } = useTheme();
  return (
    <Menu>
      <Tooltip content="Theme">
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Theme">
            {themeIcons[theme]}
          </Button>
        </MenuTrigger>
      </Tooltip>
      <MenuContent className="min-w-36">
        {(["light", "dark", "system"] as Theme[]).map((t) => (
          <MenuItem key={t} icon={themeIcons[t]} onSelect={() => setTheme(t)} hint={t === theme ? <Check className="size-3.5" /> : null}>
            {t[0]!.toUpperCase() + t.slice(1)}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

function UserMenu() {
  const who = useQuery(whoamiQuery);
  const session = useSession();
  const navigate = useNavigate();
  const here = useRouterState({ select: (s) => s.location.href });

  if (who.isPending) return <span className="h-8 w-20 animate-pulse rounded-md bg-muted" aria-hidden />;
  if (!who.data || who.data.kind === "anonymous") {
    return (
      <Button asChild variant="secondary">
        <Link to="/sign-in" search={here.startsWith("/sign-in") ? {} : { redirect: here }}>
          <LogIn />
          Sign in
        </Link>
      </Button>
    );
  }

  const me = who.data;
  const out = async () => {
    await signOut();
    void navigate({ to: "/" });
  };
  // The demo signs in as any of its users with any password: one click to see their view.
  const viewAs = async (name: string) => {
    await signOut();
    await signInWithPassword(name, "demo");
  };
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" className="gap-2 px-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-soft-foreground uppercase">
            {me.name.slice(0, 1) || <User className="size-3.5" />}
          </span>
          <span className="hidden text-sm lg:inline">{me.name}</span>
        </Button>
      </MenuTrigger>
      <MenuContent className="w-72">
        <MenuLabel>
          Signed in as <span className="font-mono text-foreground">{me.principal}</span>
          {me.admin ? <Badge tone="primary" className="ml-1.5">admin</Badge> : null}
        </MenuLabel>
        {me.bindings?.length ? (
          <div className="px-2 pb-1.5 text-xs text-muted-foreground">
            {me.bindings.map((b) => (
              <div key={b.id} className="font-mono">
                {b.role} on {b.repoMask}
              </div>
            ))}
          </div>
        ) : null}
        {session?.expiresAt ? (
          <div className="px-2 pb-1.5 text-xs text-muted-foreground">
            Session ends <RelativeTime iso={session.expiresAt} />
          </div>
        ) : null}
        <MenuSeparator />
        {demoMode().active ? (
          <>
            <MenuLabel className="flex items-center gap-1.5">
              <FlaskConical className="size-3.5" />
              Demo: view as
            </MenuLabel>
            {demoUsers.map((u) => (
              <MenuItem
                key={u.name}
                onSelect={() => void viewAs(u.name)}
                hint={u.name === me.name ? <Check className="size-3.5" /> : null}
              >
                <span className="font-mono">{u.name}</span>
                <span className="block text-xs text-muted-foreground">{u.description}</span>
              </MenuItem>
            ))}
            <MenuSeparator />
          </>
        ) : null}
        <MenuItem icon={<KeyRound />} onSelect={() => void navigate({ to: "/tokens" })}>
          Personal access tokens
        </MenuItem>
        <MenuItem icon={<LogOut />} onSelect={() => void out()}>
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

/** Says that this is the demo, and how to start it over or leave it. */
function DemoBar({ forced }: { forced: boolean }) {
  return (
    <div className="border-t border-warning/25 bg-warning-soft">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1 text-xs sm:px-6">
        <FlaskConical className="size-3.5 shrink-0 text-warning" />
        <span className="min-w-0 flex-1">
          Demo: the data is generated and kept in this browser. Nothing you do here reaches a server.
        </span>
        <Button size="sm" variant="ghost" onClick={resetDemo}>
          Reset data
        </Button>
        {forced ? null : (
          <Button size="sm" onClick={exitDemo}>
            Exit demo
          </Button>
        )}
      </div>
    </div>
  );
}

export function AppShell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const who = useQuery(whoamiQuery);
  const info = useQuery(infoQuery);
  const demo = demoMode();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.title = config().title;
  }, []);

  const isMac = navigator.platform.toLowerCase().includes("mac");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-13 max-w-7xl items-center gap-2 px-4 sm:px-6">
          <Link to="/" className="mr-2 flex items-center gap-2 rounded-md">
            <Logo />
            <span className="text-[15px] font-semibold tracking-tight">{config().title}</span>
          </Link>
          {demo.active ? (
            <Tooltip content="Demo: the API is answered in this browser on generated data; nothing reaches a server.">
              <Badge tone="warning" shape="square" className="hidden sm:inline-flex">
                <FlaskConical />
                demo
              </Badge>
            </Tooltip>
          ) : null}
          <nav className="ml-2 flex items-center gap-0.5">
            <NavLink to="/" icon={<Boxes />}>
              Repositories
            </NavLink>
            {demo.active ? (
              <NavLink to="/api-docs" icon={<Braces />}>
                API
              </NavLink>
            ) : null}
            {who.data?.admin ? (
              <>
                <NavLink to="/registries" icon={<Server />}>
                  Registries
                </NavLink>
                <NavLink to="/audit" icon={<History />}>
                  Audit
                </NavLink>
                <NavLink to="/access" icon={<Users />}>
                  Access
                </NavLink>
              </>
            ) : null}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex h-8 w-9 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-sm text-muted-foreground shadow-card transition-colors hover:text-foreground sm:w-64"
            >
              <Search className="size-4 shrink-0" />
              <span className="hidden flex-1 text-left sm:inline">Search packages…</span>
              <span className="hidden items-center gap-0.5 sm:flex">
                <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>
            <ThemeMenu />
            <UserMenu />
          </div>
        </div>
        {demo.active ? <DemoBar forced={demo.forced} /> : null}
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <Outlet />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-xs text-muted-foreground sm:px-6">
          <span>
            Lajstrom {info.data?.version ?? "…"}
            {info.data?.commit ? ` · ${info.data.commit}` : ""}
          </span>
          <span>·</span>
          <span>UI prototype{demo.active ? " · demo data" : ""}</span>
          <span className="ml-auto">
            Press <Kbd>/</Kbd> to search
          </span>
        </div>
      </footer>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
