"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveCache = exports.reserveCache = exports.downloadCache = exports.getCacheEntry = exports.getCacheVersion = void 0;
const core = __importStar(require("@actions/core"));
const http_client_1 = require("@actions/http-client");
const auth_1 = require("@actions/http-client/lib/auth");
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const url_1 = require("url");
const utils = __importStar(require("./cacheUtils"));
const constants_1 = require("./constants");
const downloadUtils_1 = require("./downloadUtils");
const options_1 = require("../options");
const requestUtils_1 = require("./requestUtils");
const versionSalt = '1.0';
function getCacheApiUrl(resource) {
    const baseUrl = process.env['ACTIONS_CACHE_URL'] || '';
    if (!baseUrl) {
        throw new Error('Cache Service Url not found, unable to restore cache.');
    }
    const url = `${baseUrl}_apis/artifactcache/${resource}`;
    core.debug(`Resource Url: ${url}`);
    return url;
}
function createAcceptHeader(type, apiVersion) {
    return `${type};api-version=${apiVersion}`;
}
function getRequestOptions() {
    const requestOptions = {
        headers: {
            Accept: createAcceptHeader('application/json', '6.0-preview.1')
        }
    };
    return requestOptions;
}
function createHttpClient() {
    const token = process.env['ACTIONS_RUNTIME_TOKEN'] || '';
    const bearerCredentialHandler = new auth_1.BearerCredentialHandler(token);
    return new http_client_1.HttpClient('actions/cache', [bearerCredentialHandler], getRequestOptions());
}
function getCacheVersion(paths, compressionMethod) {
    const components = paths.concat(!compressionMethod || compressionMethod === constants_1.CompressionMethod.Gzip
        ? []
        : [compressionMethod]);
    // Add salt to cache version to support breaking changes in cache entry
    components.push(versionSalt);
    return crypto
        .createHash('sha256')
        .update(components.join('|'))
        .digest('hex');
}
exports.getCacheVersion = getCacheVersion;
function getCacheEntry(keys, paths, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const httpClient = createHttpClient();
        const version = getCacheVersion(paths, options === null || options === void 0 ? void 0 : options.compressionMethod);
        const resource = `cache?keys=${encodeURIComponent(keys.join(','))}&version=${version}`;
        const response = yield requestUtils_1.retryTypedResponse('getCacheEntry', () => __awaiter(this, void 0, void 0, function* () { return httpClient.getJson(getCacheApiUrl(resource)); }));
        if (response.statusCode === 204) {
            return null;
        }
        if (!requestUtils_1.isSuccessStatusCode(response.statusCode)) {
            throw new Error(`Cache service responded with ${response.statusCode}`);
        }
        const cacheResult = response.result;
        const cacheDownloadUrl = cacheResult === null || cacheResult === void 0 ? void 0 : cacheResult.archiveLocation;
        if (!cacheDownloadUrl) {
            throw new Error('Cache not found.');
        }
        core.setSecret(cacheDownloadUrl);
        core.debug(`Cache Result:`);
        core.debug(JSON.stringify(cacheResult));
        return cacheResult;
    });
}
exports.getCacheEntry = getCacheEntry;
function downloadCache(archiveLocation, archivePath, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const archiveUrl = new url_1.URL(archiveLocation);
        const downloadOptions = options_1.getDownloadOptions(options);
        if (downloadOptions.useAzureSdk &&
            archiveUrl.hostname.endsWith('.blob.core.windows.net')) {
            // Use Azure storage SDK to download caches hosted on Azure to improve speed and reliability.
            yield downloadUtils_1.downloadCacheStorageSDK(archiveLocation, archivePath, downloadOptions);
        }
        else {
            // Otherwise, download using the Actions http-client.
            yield downloadUtils_1.downloadCacheHttpClient(archiveLocation, archivePath);
        }
    });
}
exports.downloadCache = downloadCache;
// Reserve Cache
function reserveCache(key, paths, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const httpClient = createHttpClient();
        const version = getCacheVersion(paths, options === null || options === void 0 ? void 0 : options.compressionMethod);
        const reserveCacheRequest = {
            key,
            version,
            cacheSize: options === null || options === void 0 ? void 0 : options.cacheSize
        };
        const response = yield requestUtils_1.retryTypedResponse('reserveCache', () => __awaiter(this, void 0, void 0, function* () {
            return httpClient.postJson(getCacheApiUrl('caches'), reserveCacheRequest);
        }));
        return response;
    });
}
exports.reserveCache = reserveCache;
function getContentRange(start, end) {
    // Format: `bytes start-end/filesize
    // start and end are inclusive
    // filesize can be *
    // For a 200 byte chunk starting at byte 0:
    // Content-Range: bytes 0-199/*
    return `bytes ${start}-${end}/*`;
}
function uploadChunk(httpClient, resourceUrl, openStream, start, end) {
    return __awaiter(this, void 0, void 0, function* () {
        core.debug(`Uploading chunk of size ${end -
            start +
            1} bytes at offset ${start} with content range: ${getContentRange(start, end)}`);
        const additionalHeaders = {
            'Content-Type': 'application/octet-stream',
            'Content-Range': getContentRange(start, end)
        };
        const uploadChunkResponse = yield requestUtils_1.retryHttpClientResponse(`uploadChunk (start: ${start}, end: ${end})`, () => __awaiter(this, void 0, void 0, function* () {
            return httpClient.sendStream('PATCH', resourceUrl, openStream(), additionalHeaders);
        }));
        if (!requestUtils_1.isSuccessStatusCode(uploadChunkResponse.message.statusCode)) {
            throw new Error(`Cache service responded with ${uploadChunkResponse.message.statusCode} during upload chunk.`);
        }
    });
}
function uploadFile(httpClient, cacheId, archivePath, options) {
    return __awaiter(this, void 0, void 0, function* () {
        // Upload Chunks
        const fileSize = utils.getArchiveFileSizeInBytes(archivePath);
        const resourceUrl = getCacheApiUrl(`caches/${cacheId.toString()}`);
        const fd = fs.openSync(archivePath, 'r');
        const uploadOptions = options_1.getUploadOptions(options);
        const concurrency = utils.assertDefined('uploadConcurrency', uploadOptions.uploadConcurrency);
        const maxChunkSize = utils.assertDefined('uploadChunkSize', uploadOptions.uploadChunkSize);
        const parallelUploads = [...new Array(concurrency).keys()];
        core.debug('Awaiting all uploads');
        let offset = 0;
        try {
            yield Promise.all(parallelUploads.map(() => __awaiter(this, void 0, void 0, function* () {
                while (offset < fileSize) {
                    const chunkSize = Math.min(fileSize - offset, maxChunkSize);
                    const start = offset;
                    const end = offset + chunkSize - 1;
                    offset += maxChunkSize;
                    yield uploadChunk(httpClient, resourceUrl, () => fs
                        .createReadStream(archivePath, {
                        fd,
                        start,
                        end,
                        autoClose: false
                    })
                        .on('error', error => {
                        throw new Error(`Cache upload failed because file read failed with ${error.message}`);
                    }), start, end);
                }
            })));
        }
        finally {
            fs.closeSync(fd);
        }
        return;
    });
}
function commitCache(httpClient, cacheId, filesize) {
    return __awaiter(this, void 0, void 0, function* () {
        const commitCacheRequest = { size: filesize };
        return yield requestUtils_1.retryTypedResponse('commitCache', () => __awaiter(this, void 0, void 0, function* () {
            return httpClient.postJson(getCacheApiUrl(`caches/${cacheId.toString()}`), commitCacheRequest);
        }));
    });
}
function saveCache(cacheId, archivePath, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const httpClient = createHttpClient();
        core.debug('Upload cache');
        yield uploadFile(httpClient, cacheId, archivePath, options);
        // Commit Cache
        core.debug('Commiting cache');
        const cacheSize = utils.getArchiveFileSizeInBytes(archivePath);
        core.info(`Cache Size: ~${Math.round(cacheSize / (1024 * 1024))} MB (${cacheSize} B)`);
        const commitCacheResponse = yield commitCache(httpClient, cacheId, cacheSize);
        if (!requestUtils_1.isSuccessStatusCode(commitCacheResponse.statusCode)) {
            throw new Error(`Cache service responded with ${commitCacheResponse.statusCode} during commit cache.`);
        }
        core.info('Cache saved successfully');
    });
}
exports.saveCache = saveCache;
//# sourceMappingURL=cacheHttpClient.js.map