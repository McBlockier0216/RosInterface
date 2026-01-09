"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SnapshotSubscription = void 0;
class SnapshotSubscription {
    constructor(client, callback, unsubscribeFn) {
        this.isDiffMode = false;
        this.throttleMs = 0;
        this.joinConfig = null;
        this.lastExecutionTime = 0;
        this.previousSnapshot = [];
        this.throttleTimer = null;
        this.pendingUpdate = null;
        this.client = client;
        this.callback = callback;
        this.unsubscribeFn = unsubscribeFn;
    }
    onDiff() {
        this.isDiffMode = true;
        return this;
    }
    throttle(ms) {
        this.throttleMs = ms;
        return this;
    }
    join(config) {
        this.joinConfig = config;
        return this;
    }
    stop() {
        this.clearPending();
        this.unsubscribeFn();
    }
    async processUpdate(newData) {
        const now = Date.now();
        const timeSinceLast = now - this.lastExecutionTime;
        if (this.throttleMs === 0) {
            await this.executeCallbackLogic(newData);
            this.lastExecutionTime = Date.now();
            return;
        }
        if (timeSinceLast >= this.throttleMs) {
            this.clearPending();
            await this.executeCallbackLogic(newData);
            this.lastExecutionTime = Date.now();
        }
        else {
            this.pendingUpdate = newData;
            if (!this.throttleTimer) {
                const waitTime = this.throttleMs - timeSinceLast;
                this.throttleTimer = setTimeout(() => {
                    this.flushPending();
                }, waitTime);
            }
        }
    }
    async flushPending() {
        this.throttleTimer = null;
        if (this.pendingUpdate) {
            await this.executeCallbackLogic(this.pendingUpdate);
            this.lastExecutionTime = Date.now();
            this.pendingUpdate = null;
        }
    }
    clearPending() {
        if (this.throttleTimer) {
            clearTimeout(this.throttleTimer);
            this.throttleTimer = null;
        }
        this.pendingUpdate = null;
    }
    async executeCallbackLogic(currentData) {
        let processedData = currentData;
        if (this.joinConfig) {
            try {
                const foreignData = await this.client.write(`${this.joinConfig.from}/print`);
                const foreignMap = new Map();
                foreignData.forEach((item) => {
                    const key = String(item[this.joinConfig.foreignField]);
                    foreignMap.set(key, item);
                });
                processedData = currentData.map(localItem => {
                    const key = String(localItem[this.joinConfig.localField]);
                    return {
                        ...localItem,
                        [this.joinConfig.as]: foreignMap.get(key) || null
                    };
                });
            }
            catch (error) {
                console.warn(`RosInterface: Join failed for ${this.joinConfig.from}. Returning un-joined data.`, error);
            }
        }
        if (this.isDiffMode) {
            const diff = this.calculateDiff(this.previousSnapshot, processedData);
            this.previousSnapshot = processedData;
            if (diff.added.length > 0 || diff.modified.length > 0 || diff.removed.length > 0) {
                this.callback(diff);
            }
        }
        else {
            this.previousSnapshot = processedData;
            this.callback(processedData);
        }
    }
    calculateDiff(oldData, newData) {
        const diff = { added: [], modified: [], removed: [], current: newData };
        const getId = (item) => {
            if (item['.id'])
                return item['.id'];
            if (item['name'])
                return `name:${item['name']}`;
            return JSON.stringify(item);
        };
        const oldMap = new Map();
        oldData.forEach(item => oldMap.set(getId(item), item));
        const newMap = new Map();
        newData.forEach(item => newMap.set(getId(item), item));
        for (const newItem of newData) {
            const id = getId(newItem);
            if (!oldMap.has(id)) {
                diff.added.push(newItem);
            }
            else {
                const oldItem = oldMap.get(id);
                if (!this.areEqual(oldItem, newItem)) {
                    diff.modified.push(newItem);
                }
            }
        }
        for (const oldItem of oldData) {
            const id = getId(oldItem);
            if (!newMap.has(id)) {
                diff.removed.push(oldItem);
            }
        }
        return diff;
    }
    areEqual(obj1, obj2) {
        return JSON.stringify(obj1) === JSON.stringify(obj2);
    }
}
exports.SnapshotSubscription = SnapshotSubscription;
//# sourceMappingURL=SnapshotSubscription.js.map