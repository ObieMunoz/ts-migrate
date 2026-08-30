/**
 * The entry a key holds, inserting the one `create` returns when the map has
 * none. The insertion order a caller builds up is the order it reads back.
 */
export function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const created = create();
  map.set(key, created);
  return created;
}
