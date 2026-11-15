// node scripts/server-describe.ts <commit>: the commit of lajstrom/lajstrom as git describe --tags
// would name it there, from GitHub's API, without a clone: the release tag itself, or the nearest
// release tag before it and how many commits after it (v0.0.1-959-gf0d887d). Prints nothing
// when no release tag is before the commit. scripts/update-server-openapi.sh writes it into the
// first line of openapi/server.yaml, so that the bundle knows which server version its API is
// (scripts/build-info.ts) and can tell an older or a newer server.
//
// The server's main has a linear history, so the highest release tag that the commit is on or
// after is the nearest one. GITHUB_TOKEN, when set, lifts the API's rate limit.

const repo = "https://api.github.com/repos/lajstrom/lajstrom";
const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${repo}/${path}`, { headers });
  if (!res.ok) throw new Error(`GET ${repo}/${path}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** vX.Y.Z or vX.Y.Z-<pre-release>, as numbers and the pre-release, or null. */
function release(tag: string): { n: number[]; pre: string } | null {
  const m = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(tag);
  return m ? { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? "" } : null;
}

/** Newest first: by the numbers, and a release before its own pre-releases. */
function newestFirst(a: string, b: string): number {
  const x = release(a)!;
  const y = release(b)!;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return y.n[i]! - x.n[i]!;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return -1;
  if (!y.pre) return 1;
  return y.pre.localeCompare(x.pre, "en", { numeric: true });
}

const commit = process.argv[2] ?? "";
if (!/^[0-9a-f]{40}$/.test(commit)) {
  console.error("usage: node scripts/server-describe.ts <40-character commit of lajstrom/lajstrom>");
  process.exit(2);
}

const tags = (await get<{ name: string }[]>("tags?per_page=100")).map((t) => t.name).filter((t) => release(t) !== null);
tags.sort(newestFirst);
for (const tag of tags) {
  const cmp = await get<{ status: string; ahead_by: number }>(`compare/${tag}...${commit}`);
  if (cmp.status === "identical") {
    console.log(tag);
    break;
  }
  if (cmp.status === "ahead") {
    console.log(`${tag}-${cmp.ahead_by}-g${commit.slice(0, 7)}`);
    break;
  }
}
