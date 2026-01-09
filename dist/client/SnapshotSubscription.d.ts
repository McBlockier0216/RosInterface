import { MikrotikClient } from './MikrotikClient';
export interface SnapshotDiff<T> {
    added: T[];
    modified: T[];
    removed: T[];
    current: T[];
}
export declare class SnapshotSubscription<T extends Record<string, any>> {
    private isDiffMode;
    private throttleMs;
    private joinConfig;
    private lastExecutionTime;
    private previousSnapshot;
    private throttleTimer;
    private pendingUpdate;
    private readonly callback;
    private readonly client;
    private readonly unsubscribeFn;
    constructor(client: MikrotikClient, callback: (data: any) => void, unsubscribeFn: () => void);
    onDiff(): this;
    throttle(ms: number): this;
    join(config: {
        from: string;
        localField: string;
        foreignField: string;
        as: string;
    }): this;
    stop(): void;
    processUpdate(newData: T[]): Promise<void>;
    private flushPending;
    private clearPending;
    private executeCallbackLogic;
    private calculateDiff;
    private areEqual;
}
