"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandBuilder = void 0;
const Helpers_1 = require("../utils/Helpers");
const MikrotikCollection_1 = require("../utils/MikrotikCollection");
const OfflineQueue_1 = require("../core/OfflineQueue");
class CommandBuilder {
    constructor(client, menuPath) {
        this.queryParams = {};
        this.propList = [];
        this.isPersistentRequest = false;
        this.client = client;
        this.menuPath = menuPath.startsWith('/') ? menuPath : '/' + menuPath;
        if (this.menuPath.endsWith('/') && this.menuPath.length > 1) {
            this.menuPath = this.menuPath.slice(0, -1);
        }
    }
    where(key, value) {
        const kebabKey = (0, Helpers_1.camelToKebab)(key);
        const formattedValue = this.formatValue(value);
        this.queryParams[`?${kebabKey}`] = formattedValue;
        return this;
    }
    whereExists(key) {
        const kebabKey = (0, Helpers_1.camelToKebab)(key);
        this.queryParams[`?${kebabKey}`] = '';
        return this;
    }
    select(fields) {
        const kebabFields = fields.map(f => (0, Helpers_1.camelToKebab)(f));
        this.propList.push(...kebabFields);
        return this;
    }
    persistent() {
        this.isPersistentRequest = true;
        return this;
    }
    async findBy(criteria) {
        for (const [key, value] of Object.entries(criteria)) {
            this.where(key, value);
        }
        return this.print();
    }
    async findOne(criteria) {
        const collection = await this.findBy(criteria);
        return collection.first();
    }
    async print(extraParams) {
        const fluentParams = this.getParams();
        const finalParams = { ...fluentParams, ...extraParams };
        const host = this.client.options?.host || 'default';
        const cacheKey = `${host}:${this.menuPath}:${JSON.stringify(finalParams)}`;
        const cached = CommandBuilder.queryCache.get(cacheKey);
        if (cached && Date.now() < cached.expires) {
            return new MikrotikCollection_1.MikrotikCollection(cached.data);
        }
        const rawData = await this.client.write(`${this.menuPath}/print`, finalParams);
        CommandBuilder.queryCache.set(cacheKey, {
            data: rawData,
            expires: Date.now() + CommandBuilder.CACHE_TTL_MS
        });
        if (Math.random() > 0.95)
            this.pruneCache();
        return new MikrotikCollection_1.MikrotikCollection(rawData);
    }
    pruneCache() {
        const now = Date.now();
        for (const [key, val] of CommandBuilder.queryCache.entries()) {
            if (now > val.expires)
                CommandBuilder.queryCache.delete(key);
        }
    }
    async first() {
        const collection = await this.print();
        return collection.first();
    }
    async add(data) {
        const params = this.prepareParams(data);
        if (this.shouldDefer()) {
            OfflineQueue_1.OfflineQueue.enqueue({ action: 'add', path: this.menuPath, params: params });
            return 'QUEUED_OFFLINE';
        }
        const response = await this.client.write(`${this.menuPath}/add`, params);
        this.invalidatePathCache();
        if (Array.isArray(response) && response.length > 0 && response[0]['ret']) {
            return response[0]['ret'];
        }
        return '';
    }
    async set(id, data) {
        const params = this.prepareParams(data);
        params['.id'] = id;
        if (this.shouldDefer()) {
            OfflineQueue_1.OfflineQueue.enqueue({ action: 'set', path: this.menuPath, params: params });
            return;
        }
        await this.client.write(`${this.menuPath}/set`, params);
        this.invalidatePathCache();
    }
    async remove(id) {
        const ids = Array.isArray(id) ? id.join(',') : id;
        const params = { '.id': ids };
        if (this.shouldDefer()) {
            OfflineQueue_1.OfflineQueue.enqueue({ action: 'remove', path: this.menuPath, params: params });
            return;
        }
        await this.client.write(`${this.menuPath}/remove`, params);
        this.invalidatePathCache();
    }
    listen(callback) {
        const lines = [`${this.menuPath}/print`];
        const params = this.getParams();
        for (const [key, value] of Object.entries(params)) {
            let cleanKey = key;
            if (cleanKey.startsWith('?')) {
                cleanKey = cleanKey.substring(1);
            }
            if (cleanKey === '.proplist') {
                lines.push(`=${cleanKey}=${value}`);
            }
            else {
                lines.push(`?${cleanKey}=${value}`);
            }
        }
        lines.push('=follow=');
        return this.client.stream(lines, undefined, callback);
    }
    listenMonitor(callback) {
        const rawParams = this.getParams();
        const actionParams = {};
        for (const [key, value] of Object.entries(rawParams)) {
            const cleanKey = key.startsWith('?') ? key.substring(1) : key;
            actionParams[cleanKey] = value;
        }
        let cmd = this.menuPath;
        if (!cmd.endsWith('monitor-traffic') && !cmd.endsWith('torch')) {
            cmd = `${cmd}/monitor-traffic`;
        }
        return this.client.stream(cmd, actionParams, callback);
    }
    invalidatePathCache() {
        const host = this.client.options?.host || 'default';
        const prefix = `${host}:${this.menuPath}`;
        for (const key of CommandBuilder.queryCache.keys()) {
            if (key.startsWith(prefix)) {
                CommandBuilder.queryCache.delete(key);
            }
        }
    }
    shouldDefer() {
        if (!this.isPersistentRequest)
            return false;
        return !this.isClientConnected();
    }
    isClientConnected() {
        const socket = this.client['socket'];
        return socket && socket['connected'] === true;
    }
    getParams() {
        const params = { ...this.queryParams };
        if (this.propList.length > 0) {
            params['.proplist'] = this.propList.join(',');
        }
        return params;
    }
    formatValue(value) {
        if (typeof value === 'boolean') {
            return value ? 'yes' : 'no';
        }
        return String(value);
    }
    prepareParams(data) {
        const params = {};
        for (const [key, value] of Object.entries(data)) {
            const kebabKey = (0, Helpers_1.camelToKebab)(key);
            params[kebabKey] = this.formatValue(value);
        }
        return params;
    }
}
exports.CommandBuilder = CommandBuilder;
CommandBuilder.queryCache = new Map();
CommandBuilder.CACHE_TTL_MS = 5000;
//# sourceMappingURL=CommandBuilder.js.map