"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OfflineQueue = void 0;
class OfflineQueue {
    static enqueue(task) {
        const fullTask = {
            id: Math.random().toString(36).substring(2, 15),
            timestamp: Date.now(),
            ...task
        };
        this.storage.push(fullTask);
        console.log(`Router offline. Task queued: ${fullTask.action.toUpperCase()} on ${fullTask.path}`);
    }
    static flush() {
        const tasks = [...this.storage];
        this.storage = [];
        return tasks;
    }
    static get size() {
        return this.storage.length;
    }
}
exports.OfflineQueue = OfflineQueue;
OfflineQueue.storage = [];
//# sourceMappingURL=OfflineQueue.js.map