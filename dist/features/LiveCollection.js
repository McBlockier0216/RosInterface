"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiveCollection = void 0;
const SnapshotSubscription_1 = require("../client/SnapshotSubscription");
class LiveCollection {
    constructor(client, path, query = {}) {
        this.client = client;
        this.path = path;
        this.query = query;
        this.localCache = new Map();
        this.subscription = null;
        this.subscriptions = [];
        this.isInitializing = false;
    }
    onSnapshot(callback) {
        const unsubscribeLogic = () => {
            this.subscriptions = this.subscriptions.filter(s => s !== sub);
            if (this.subscriptions.length === 0) {
                this.stopListening();
            }
        };
        const sub = new SnapshotSubscription_1.SnapshotSubscription(this.client, callback, unsubscribeLogic);
        this.subscriptions.push(sub);
        if (this.localCache.size > 0) {
            sub.processUpdate(Array.from(this.localCache.values()));
        }
        if (!this.subscription && !this.isInitializing) {
            this.startListening().catch(err => {
                console.error("RosInterface: Error starting live listener", err);
            });
        }
        return sub;
    }
    async startListening() {
        if (this.isInitializing)
            return;
        this.isInitializing = true;
        try {
            const cmd = this.client.command(this.path);
            cmd.where('.proplist', '.id,.dead,name,comment,disabled,profile,service,user,password,address,uptime,mac-address,caller-id,bytes-in,bytes-out,radius');
            if (this.query) {
                Object.keys(this.query).forEach(key => {
                    const value = this.query[key];
                    if (['string', 'number', 'boolean'].includes(typeof value)) {
                        cmd.where(key, value);
                    }
                });
            }
            this.subscription = cmd.listen((packet) => {
                this.processPacket(packet);
            });
        }
        catch (error) {
            console.error(`RosInterface: Failed to listen on ${this.path}`, error);
            this.isInitializing = false;
        }
    }
    processPacket(packet) {
        const rawId = packet['.id'] || packet['id'];
        if (!rawId)
            return;
        if (packet['.dead'] === true || packet['dead'] === true) {
            this.localCache.delete(rawId);
        }
        else {
            const existing = this.localCache.get(rawId) || {};
            const cleanPacket = {};
            for (const key of Object.keys(packet)) {
                const cleanKey = key.startsWith('.') ? key.substring(1) : key;
                cleanPacket[cleanKey] = packet[key];
            }
            const updated = { ...existing, ...cleanPacket };
            this.localCache.set(rawId, updated);
        }
        this.emit();
    }
    emit() {
        const fullList = Array.from(this.localCache.values());
        this.subscriptions.forEach(sub => {
            sub.processUpdate(fullList);
        });
    }
    stopListening() {
        if (this.subscription) {
            try {
                this.subscription.stop();
            }
            catch (e) {
                console.warn('RosInterface: Error stopping subscription', e);
            }
            this.subscription = null;
        }
        this.localCache.clear();
        this.isInitializing = false;
    }
}
exports.LiveCollection = LiveCollection;
//# sourceMappingURL=LiveCollection.js.map