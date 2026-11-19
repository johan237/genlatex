/**
 * Server-side cache for Zotero API responses (collections).
 * Reduces calls to Zotero API; invalidate when user links, unlinks, or OAuth connects.
 */

const TTL_MS = 2 * 60 * 1000; // 2 minutes

const collectionsByUser = new Map();

export function getCachedCollections(userId) {
  const entry = collectionsByUser.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TTL_MS) {
    collectionsByUser.delete(userId);
    return null;
  }
  return entry.data;
}

export function setCachedCollections(userId, data) {
  collectionsByUser.set(userId, { data, timestamp: Date.now() });
}

export function invalidateZoteroServerCache(userId) {
  if (userId) {
    collectionsByUser.delete(userId);
  } else {
    collectionsByUser.clear();
  }
}
