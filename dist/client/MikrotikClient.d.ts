import { SocketClientOptions } from "../core/SocketClient";
import { CommandBuilder } from "./CommandBuilder";
import { SchemaMapper } from '../core/SchemaMapper';
import { CircuitBreakerOptions } from '../core/CircuitBreaker';
import { FileManager } from '../features/FileManager';
import { MetricDefinition } from '../features/PrometheusExporter';
import { SnapshotCallback } from "../features/LiveCollection";
import { SnapshotSubscription } from "./SnapshotSubscription";
import { MikrotikTransaction } from "./MikrotikTransaction";
export interface MikrotikOptions extends SocketClientOptions {
    user?: string;
    password?: string;
    allowInsecureConfig?: boolean;
    rateLimit?: number;
    circuitBreaker?: CircuitBreakerOptions;
}
export interface Subscription {
    stop: () => Promise<void>;
}
export declare class MikrotikClient {
    private socket;
    private readonly options;
    private readonly isConfigFromEnv;
    private activeLiveCollections;
    readonly files: FileManager;
    readonly schema: SchemaMapper;
    private rateLimiter;
    private breaker;
    private pendingCommands;
    private currentSentence;
    constructor(options: MikrotikOptions);
    connect(): Promise<void>;
    private printSeriousWarning;
    close(): void;
    command<T extends Record<string, any> = any>(path: string): CommandBuilder<T>;
    transaction(): MikrotikTransaction;
    collection<T extends Record<string, any> = Record<string, any>>(path: string): {
        where: (key: string, value: string | number | boolean) => any;
        print: () => Promise<import("..").MikrotikCollection<T>>;
        onSnapshot: (callback: SnapshotCallback<T>) => SnapshotSubscription<T>;
    };
    getMetrics(path: string, metrics: MetricDefinition[], params?: Record<string, any>): Promise<string>;
    write(command: string, parameters?: Record<string, string | boolean | number>): Promise<any[]>;
    stream(commandOrLines: string | string[], parameters: Record<string, string | boolean | number> | undefined, callback: (data: any) => void): Subscription;
    private generateTag;
    private buildPayload;
    private sendPayload;
    private login;
    private writeInternal;
    private processIncomingWord;
    private routeSentence;
    private rejectAllCommands;
}
