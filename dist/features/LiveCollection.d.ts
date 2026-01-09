import { MikrotikClient } from "../client/MikrotikClient";
import { SnapshotSubscription, SnapshotDiff } from "../client/SnapshotSubscription";
export type SnapshotCallback<T> = (data: T[] | SnapshotDiff<T>) => void;
export declare class LiveCollection<T extends Record<string, any>> {
    private client;
    private path;
    private query;
    private localCache;
    private subscription;
    private subscriptions;
    private isInitializing;
    constructor(client: MikrotikClient, path: string, query?: Record<string, string | number | boolean>);
    onSnapshot(callback: SnapshotCallback<T>): SnapshotSubscription<T>;
    private startListening;
    private processPacket;
    private emit;
    private stopListening;
}
