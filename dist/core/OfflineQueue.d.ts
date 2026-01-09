export interface DeferredTask {
    id: string;
    path: string;
    action: 'add' | 'set' | 'remove';
    params: any;
    timestamp: number;
}
export declare class OfflineQueue {
    private static storage;
    static enqueue(task: Omit<DeferredTask, 'id' | 'timestamp' | 'status'>): void;
    static flush(): DeferredTask[];
    static get size(): number;
}
