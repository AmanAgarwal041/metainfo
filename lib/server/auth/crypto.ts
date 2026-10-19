// Row ids on Web Crypto, so the same code runs on Node and Workers.

/** 24 hex chars for row ids. */
export function randomId(): string {
  return [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
