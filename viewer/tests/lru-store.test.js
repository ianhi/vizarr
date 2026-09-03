import { expect, test } from "vitest";
import { lru } from "../src/lru-store";

/** A store that answers every key, and records what it was asked for. */
function countingStore() {
  const reads = [];
  return {
    reads,
    get: async (key) => {
      reads.push(key);
      return new Uint8Array([1]);
    },
  };
}

test("a cached store does not read a key twice", async () => {
  const store = countingStore();
  const cached = lru(store);
  await cached.get("/a");
  await cached.get("/a");
  expect(store.reads).toEqual(["/a"]);
});

test("the cache size bounds how much is remembered", async () => {
  const small = countingStore();
  const oneEntry = lru(small, 1);
  await oneEntry.get("/a");
  await oneEntry.get("/b");
  await oneEntry.get("/a");
  expect(small.reads).toEqual(["/a", "/b", "/a"]);

  const roomy = countingStore();
  const twoEntries = lru(roomy, 2);
  await twoEntries.get("/a");
  await twoEntries.get("/b");
  await twoEntries.get("/a");
  expect(roomy.reads).toEqual(["/a", "/b"]);
});
