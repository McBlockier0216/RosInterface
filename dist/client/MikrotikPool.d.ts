import { MikrotikOptions, Subscription } from './MikrotikClient';
import { CommandBuilder } from './CommandBuilder';
export interface PoolOptions extends MikrotikOptions {
    poolSize?: number;
}
export declare class MikrotikPool {
    private clients;
    private readonly options;
    private nextClientIndex;
    private isConnected;
    constructor(options: PoolOptions);
    connect(): Promise<void>;
    close(): void;
    private getScheduledClient;
    command<T extends Record<string, any> = any>(path: string): CommandBuilder<T>;
    write(command: string, parameters?: Record<string, any>): Promise<any[]>;
    stream(command: string, parameters: Record<string, any> | undefined, callback: (data: any) => void): Subscription;
}
