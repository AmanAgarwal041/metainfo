// Every workspace write goes through here, so a signed-in browser knows which
// keys to sync. Anonymous use is unchanged: it's plain localStorage.

export const LOCAL_WRITE = "metainfo:local-write";

function notify(key: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<string>(LOCAL_WRITE, { detail: key }));
}

/** Throws like localStorage.setItem (quota, blocked storage); callers already guard. */
export function setLocal(key: string, value: string) {
  localStorage.setItem(key, value);
  notify(key);
}

export function removeLocal(key: string) {
  localStorage.removeItem(key);
  notify(key);
}
