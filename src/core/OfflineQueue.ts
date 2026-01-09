/**
 * OfflineQueue.ts
 * Manages the queue of commands that are waiting for the router to reconnect.
 * * In a full production environment, this should write to a local SQLite/JSON file
 * to survive server restarts.
 */
export interface DeferredTask {
    id: string;
    path: string;
    action: 'add' | 'set' | 'remove';
    params: any;
    timestamp: number;
}

export class OfflineQueue {
    private static storage: DeferredTask[] = [];

    /**
     * Adds a task to the waiting list.
     */
    public static enqueue(task: Omit<DeferredTask, 'id' | 'timestamp' | 'status'>): void {
        const fullTask: DeferredTask = {
            id: Math.random().toString(36).substring(2, 15),
            timestamp: Date.now(),
            ...task
        };

        this.storage.push(fullTask);
        console.log(`Router offline. Task queued: ${fullTask.action.toUpperCase()} on ${fullTask.path}`);
    }

    /**
     * Returns all pending tasks and clears the queue.
     * Called by the client upon reconnection.
     */
    public static flush(): DeferredTask[] {
        const tasks = [...this.storage];
        this.storage = [];
        return tasks;
    }

    /**
     * Checks if there are pending operations.
     */
    public static get size(): number {
        return this.storage.length;
    }
}