/**
 * Torbox API client
 * Uses Bearer auth for account endpoints and supports stream URL resolution.
 */

class TorboxApi {
    constructor(baseUrl, apiKey) {
        this.baseUrl = String(baseUrl || 'https://api.torbox.app').replace(/\/+$/, '');
        this.apiKey = String(apiKey || '').trim();
    }

    async request(path, { method = 'GET', params = {}, body = null, auth = true } = {}) {
        const url = new URL(`${this.baseUrl}${path}`);
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') return;
            url.searchParams.set(key, String(value));
        });

        const headers = {
            Accept: 'application/json'
        };

        if (auth && this.apiKey) {
            headers.Authorization = `Bearer ${this.apiKey}`;
        }

        let payload = undefined;
        if (body) {
            headers['Content-Type'] = 'application/json';
            payload = JSON.stringify(body);
        }

        const response = await fetch(url.toString(), {
            method,
            headers,
            body: payload,
            signal: AbortSignal.timeout(20000)
        });

        let data = null;
        const text = await response.text();
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = text;
        }

        if (!response.ok) {
            const message = typeof data === 'object' ? (data?.detail || data?.error || response.statusText) : response.statusText;
            throw new Error(`Torbox request failed (${response.status}): ${message}`);
        }

        return data;
    }

    static extractList(payload) {
        if (Array.isArray(payload)) return payload;
        if (Array.isArray(payload?.data)) return payload.data;
        if (Array.isArray(payload?.data?.data)) return payload.data.data;
        if (Array.isArray(payload?.results)) return payload.results;
        return [];
    }

    async getUser() {
        return this.request('/v1/api/user/me');
    }

    async getTorrents(limit = 1000) {
        return TorboxApi.extractList(await this.request('/v1/api/torrents/mylist', { params: { limit } }));
    }

    async getWebDownloads(limit = 1000) {
        return TorboxApi.extractList(await this.request('/v1/api/webdl/mylist', { params: { limit } }));
    }

    async getUsenetDownloads(limit = 1000) {
        return TorboxApi.extractList(await this.request('/v1/api/usenet/mylist', { params: { limit } }));
    }

    async createStream(id, type, fileId = 0) {
        return this.request('/v1/api/stream/createstream', {
            params: { id, type, file_id: fileId }
        });
    }

    async getStreamData(token, presignedToken, chosenAudioIndex = 0) {
        return this.request('/v1/api/stream/getstreamdata', {
            params: {
                token,
                presigned_token: presignedToken,
                chosen_audio_index: chosenAudioIndex
            },
            auth: false
        });
    }

    async requestDirectDownload(type, id, fileId = 0) {
        const endpointByType = {
            torrent: '/v1/api/torrents/requestdl',
            webdl: '/v1/api/webdl/requestdl',
            usenet: '/v1/api/usenet/requestdl'
        };

        const idParamByType = {
            torrent: 'torrent_id',
            webdl: 'web_id',
            usenet: 'usenet_id'
        };

        const endpoint = endpointByType[type] || endpointByType.torrent;
        const idParam = idParamByType[type] || idParamByType.torrent;

        const params = {
            token: this.apiKey,
            file_id: fileId || 0,
            redirect: true
        };
        params[idParam] = id;

        return this.request(endpoint, { params, auth: false });
    }

    static findFirstUrl(value) {
        if (!value) return null;
        if (typeof value === 'string') {
            return /^https?:\/\//i.test(value) ? value : null;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                const found = TorboxApi.findFirstUrl(item);
                if (found) return found;
            }
            return null;
        }
        if (typeof value === 'object') {
            for (const key of Object.keys(value)) {
                const found = TorboxApi.findFirstUrl(value[key]);
                if (found) return found;
            }
        }
        return null;
    }

    async resolveStreamUrl(id, type, fileId = 0) {
        // Preferred path: create stream -> parse direct URL or token/presigned pair.
        try {
            const streamPayload = await this.createStream(id, type, fileId);
            const direct = TorboxApi.findFirstUrl(streamPayload);
            if (direct) return direct;

            const token = streamPayload?.data?.token || streamPayload?.token || streamPayload?.data?.file_token || streamPayload?.file_token;
            const presigned = streamPayload?.data?.presigned_token || streamPayload?.presigned_token;

            if (token && presigned) {
                const streamData = await this.getStreamData(token, presigned);
                const resolved = TorboxApi.findFirstUrl(streamData);
                if (resolved) return resolved;
            }
        } catch {
            // Fall through to requestdl fallback.
        }

        // Fallback path: request direct download link.
        const dlPayload = await this.requestDirectDownload(type, id, fileId);
        const fallback = TorboxApi.findFirstUrl(dlPayload);
        if (fallback) return fallback;

        throw new Error('Unable to resolve a playable Torbox stream URL.');
    }
}

function createFromSource(source) {
    const baseUrl = source?.url || 'https://api.torbox.app';
    const apiKey = source?.password || source?.apiKey || '';
    return new TorboxApi(baseUrl, apiKey);
}

module.exports = {
    TorboxApi,
    createFromSource
};
