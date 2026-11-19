/**
 * Client-side cache for Zotero status and collections.
 * Reduces API calls; invalidate when user links, unlinks, or changes Zotero settings.
 */

const TTL_MS = 5 * 60 * 1000; // 5 minutes

let statusCache = null;
let collectionsCache = null;

export function getCachedZoteroStatus() {
  if (!statusCache) return null;
  if (Date.now() - statusCache.timestamp > TTL_MS) {
    statusCache = null;
    return null;
  }
  return statusCache.data;
}

export function setCachedZoteroStatus(data) {
  statusCache = { data, timestamp: Date.now() };
}

export function getCachedZoteroCollections() {
  if (!collectionsCache) return null;
  if (Date.now() - collectionsCache.timestamp > TTL_MS) {
    collectionsCache = null;
    return null;
  }
  return collectionsCache.data;
}

export function setCachedZoteroCollections(data) {
  collectionsCache = { data, timestamp: Date.now() };
}

export function invalidateZoteroCache() {
  statusCache = null;
  collectionsCache = null;
}
