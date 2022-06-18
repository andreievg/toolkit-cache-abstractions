import {
  downloadCache,
  getCacheEntry,
  reserveCache,
  saveCache
} from './internal/cacheHttpClient'

export interface CacheHttpClient {
  getCacheEntry: typeof getCacheEntry
  downloadCache: typeof downloadCache
  reserveCache: typeof reserveCache
  saveCache: typeof saveCache
}
