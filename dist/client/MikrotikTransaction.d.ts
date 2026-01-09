import { MikrotikClient } from './MikrotikClient';
export declare class MikrotikTransaction {
    private client;
    private steps;
    private useParallel;
    constructor(client: MikrotikClient);
    add(path: string, params?: Record<string, any>): this;
    parallel(): this;
    commit(): Promise<any[]>;
    private executeSequential;
    private executeParallel;
}
