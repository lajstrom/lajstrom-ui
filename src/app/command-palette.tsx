import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import { Boxes, FileSearch, Fingerprint, History, Moon, Search, Server, Sun, Users } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useMemo, useState } from "react";

import { callerQuery, reposQuery, searchQuery } from "@/api/queries";
import type { SearchHit } from "@/api/types";
import { FormatMark } from "@/components/common";
import { Kbd } from "@/components/ui/misc";
import { shortDigest } from "@/lib/format";

import { setTheme, useTheme } from "./theme";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const itemClass =
  "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm aria-selected:bg-muted data-[disabled=true]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const q = useDebounced(input.trim(), 120);
  const repos = useQuery(reposQuery);
  const who = useQuery(callerQuery);
  const search = useQuery({ ...searchQuery(q, undefined, 8), enabled: open && q.length > 0 });
  const { resolved } = useTheme();

  const repoHits = useMemo(() => {
    const needle = input.trim().toLowerCase();
    return (repos.data ?? []).filter((r) => !needle || r.prefix.includes(needle)).slice(0, needle ? 6 : 8);
  }, [repos.data, input]);

  const close = () => {
    onOpenChange(false);
    setInput("");
  };

  const go = (fn: () => void) => {
    close();
    fn();
  };

  const openHit = (h: SearchHit) =>
    go(() => {
      if (h.kind === "package") {
        void navigate({ to: "/$format/$repo/$", params: { format: h.format, repo: h.repo, _splat: h.name } });
      } else {
        void navigate({
          to: "/$format/$repo/$",
          params: { format: h.format, repo: h.repo, _splat: `${h.name}/-/${h.version}` },
          search: h.variant ? { variant: h.variant } : {},
        });
      }
    });

  const looksLikeDigest = /^(sha256:)?[0-9a-f]{8,64}$/i.test(input.trim());
  const admin = who.data?.admin ?? false;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[1px] dark:bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-[12vh] left-1/2 z-50 w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        >
          <Dialog.Title className="sr-only">Search and go to</Dialog.Title>
          <Command shouldFilter={false} loop className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 text-muted-foreground" />
              <Command.Input
                autoFocus
                value={input}
                onValueChange={setInput}
                placeholder="Search packages, repositories, or paste a digest…"
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
              {q && search.data && search.data.hits.length === 0 && repoHits.length === 0 ? (
                <div className="px-2 py-8 text-center text-sm text-muted-foreground">
                  Nothing matches “{q}”.
                  {looksLikeDigest ? " Digests match manifests and files by prefix." : null}
                </div>
              ) : null}

              {q && (search.data?.hits.length ?? 0) > 0 ? (
                <Command.Group heading={looksLikeDigest ? "Digest matches" : "Packages"}>
                  {search.data!.hits.map((h) => (
                    <Command.Item
                      key={h.kind === "package" ? `p:${h.format}/${h.repo}/${h.name}` : `v:${h.digest}:${h.matched}`}
                      value={h.kind === "package" ? `p:${h.format}/${h.repo}/${h.name}` : `v:${h.digest}:${h.matched}`}
                      onSelect={() => openHit(h)}
                      className={itemClass}
                    >
                      <FormatMark format={h.format} />
                      {h.kind === "package" ? (
                        <>
                          <span className="min-w-0 truncate font-medium">{h.name}</span>
                          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{h.summary}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {h.repo} · {h.latestVersion}
                          </span>
                        </>
                      ) : (
                        <>
                          <Fingerprint />
                          <span className="min-w-0 truncate font-medium">
                            {h.name} {h.version}
                            {h.variant ? ` (${h.variant})` : ""}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-right font-mono text-xs text-muted-foreground">
                            {h.matched === "manifest" ? "manifest" : h.matched} · {shortDigest(h.digest)}
                          </span>
                        </>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}

              {repoHits.length > 0 ? (
                <Command.Group heading="Repositories">
                  {repoHits.map((r) => (
                    <Command.Item
                      key={r.prefix}
                      value={`r:${r.prefix}`}
                      onSelect={() => go(() => void navigate({ to: "/$format/$repo", params: { format: r.format, repo: r.name } }))}
                      className={itemClass}
                    >
                      <FormatMark format={r.format} />
                      <span className="font-medium">{r.prefix}</span>
                      <span className="flex-1 text-right text-xs text-muted-foreground">
                        {r.stats ? `${r.stats.packages} packages` : (r.registry ?? r.kind)}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}

              {q ? (
                <Command.Group heading="Search">
                  <Command.Item
                    value="search-all"
                    onSelect={() => go(() => void navigate({ to: "/search", search: { q } }))}
                    className={itemClass}
                  >
                    <FileSearch />
                    Search everything for “{q}”
                  </Command.Item>
                </Command.Group>
              ) : (
                <Command.Group heading="Go to">
                  <Command.Item value="go-repos" onSelect={() => go(() => void navigate({ to: "/" }))} className={itemClass}>
                    <Boxes />
                    Repositories
                  </Command.Item>
                  {admin ? (
                    <>
                      <Command.Item value="go-registries" onSelect={() => go(() => void navigate({ to: "/registries" }))} className={itemClass}>
                        <Server />
                        Registries
                      </Command.Item>
                      <Command.Item value="go-audit" onSelect={() => go(() => void navigate({ to: "/audit" }))} className={itemClass}>
                        <History />
                        Audit log
                      </Command.Item>
                      <Command.Item value="go-access" onSelect={() => go(() => void navigate({ to: "/access" }))} className={itemClass}>
                        <Users />
                        Users, tokens and bindings
                      </Command.Item>
                    </>
                  ) : null}
                  <Command.Item
                    value="theme"
                    onSelect={() => go(() => setTheme(resolved === "dark" ? "light" : "dark"))}
                    className={itemClass}
                  >
                    {resolved === "dark" ? <Sun /> : <Moon />}
                    Switch to {resolved === "dark" ? "light" : "dark"} theme
                  </Command.Item>
                </Command.Group>
              )}
            </Command.List>
            <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> move
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> open
              </span>
              <span className="ml-auto">Tip: paste a sha256 digest to find the package it belongs to</span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
