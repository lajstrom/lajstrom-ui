// The DPoP key of this browser's sign-in (src/api/dpop.ts): one P-256 key pair per session
// storage (the real one and the demo's, src/api/session.ts), made at the first sign-in and
// forgotten at sign-out. IndexedDB keeps the CryptoKeyPair itself, by structured clone: the
// private key stays non-extractable there and usable after a reload, which localStorage, strings
// only, could not do without exporting it. The tabs of the UI share it, as they share the session.

import { generateKeyPair } from "./dpop";
import { sessionStorageKey } from "./session";

const DATABASE = "lajstrom";
const STORE = "dpop-keys";

/** Where IndexedDB does not open (vitest in node, a browser that refuses it): the key lasts as
 * long as the page, and a session bound to it ends with a reload. */
const memory = new Map<string, CryptoKeyPair>();

let database: Promise<IDBDatabase | null> | undefined;

function open(): Promise<IDBDatabase | null> {
  database ??= new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DATABASE, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return database;
}

const isPair = (v: unknown): v is CryptoKeyPair =>
  typeof v === "object" && v !== null && "privateKey" in v && "publicKey" in v && v.privateKey instanceof CryptoKey && v.publicKey instanceof CryptoKey;

/** One transaction on the store: fn's last request's result, or undefined; rejects when the
 * transaction fails. */
function transact<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB: the transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB: the transaction was aborted"));
  });
}

async function load(name: string): Promise<CryptoKeyPair | null> {
  const db = await open();
  if (db) {
    try {
      const v = await transact<unknown>(db, "readonly", (s) => s.get(name));
      if (isPair(v)) return v;
    } catch {
      // Unreadable: as if there were none.
    }
  }
  return memory.get(name) ?? null;
}

/** The key under name, or fresh kept there: one transaction reads and writes, so that two tabs
 * signing in at once end up with one key. */
async function keep(name: string, fresh: CryptoKeyPair): Promise<CryptoKeyPair> {
  const db = await open();
  if (db) {
    try {
      let kept = fresh;
      await transact(db, "readwrite", (s) => {
        const req = s.get(name);
        req.onsuccess = () => {
          if (isPair(req.result)) kept = req.result;
          else s.put(fresh, name);
        };
      });
      return kept;
    } catch {
      // The browser would not store it (a private window of some): the page keeps it.
    }
  }
  const had = memory.get(name);
  if (had) return had;
  memory.set(name, fresh);
  return fresh;
}

/** The key the requests of a session sign with, read once per token. */
let cached: { name: string; token: string; key: Promise<CryptoKeyPair | null> } | null = null;

/** The key of the session whose token this is, or null when this browser has none: its site data
 * was cleared, or the key was forgotten by a sign-out in another tab. */
export function sessionKey(token: string): Promise<CryptoKeyPair | null> {
  const name = sessionStorageKey();
  if (cached?.name !== name || cached.token !== token) cached = { name, token, key: load(name) };
  return cached.key;
}

/** The key to sign in with: the one this browser has, or a new one, kept. */
export async function signInKey(): Promise<CryptoKeyPair> {
  const name = sessionStorageKey();
  return (await load(name)) ?? keep(name, await generateKeyPair());
}

/** Forgets the key at sign-out: a token that outlives it, its revocation failed, is of no use. */
export async function forgetKey(): Promise<void> {
  const name = sessionStorageKey();
  cached = null;
  memory.delete(name);
  const db = await open();
  if (!db) return;
  try {
    await transact(db, "readwrite", (s) => s.delete(name));
  } catch {
    // Not deleted: the next sign-in takes it again.
  }
}
