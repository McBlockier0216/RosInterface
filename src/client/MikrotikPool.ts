import { MikrotikClient, MikrotikOptions, Subscription } from './MikrotikClient';
import { CommandBuilder } from './CommandBuilder';

export interface PoolOptions extends MikrotikOptions {
    /**
     * Number of simultaneous connections to maintain.
     * Default: 5
     */
    poolSize?: number;
}

/**
 * MikrotikPool
 * Manages a cluster of MikrotikClient instances to distribute load.
 * Uses a Round-Robin algorithm to schedule commands across available sockets.
 */
export class MikrotikPool {
    private clients: MikrotikClient[] = [];
    private readonly options: PoolOptions;
    private nextClientIndex: number = 0;
    private isConnected: boolean = false;

    constructor(options: PoolOptions) {
        this.options = {
            poolSize: 5, // Default to 5 concurrent connections
            ...options
        };
    }

    /**
     * Initializes the pool by establishing all connections in parallel.
     */
    public async connect(): Promise<void> {
        if (this.isConnected) return;

        console.log(`Initializing Pool with ${this.options.poolSize} connections...`);

        const connectionPromises: Promise<void>[] = [];

        for (let i = 0; i < (this.options.poolSize || 5); i++) {
            const client = new MikrotikClient(this.options);
            this.clients.push(client);
            // We initiate all connections simultaneously
            connectionPromises.push(client.connect());
        }

        // Wait for ALL clients to be ready
        await Promise.all(connectionPromises);
        this.isConnected = true;
        console.log(`Pool Ready: ${this.clients.length} sockets connected.`);
    }

    /**
     * Closes all connections in the pool gracefully.
     */
    public close(): void {
        this.clients.forEach(client => client.close());
        this.isConnected = false;
        this.clients = [];
    }

    /**
     * Round-Robin Scheduler.
     * Selects the next available client in the list to distribute the load evenly.
     */
    private getScheduledClient(): MikrotikClient {
        if (this.clients.length === 0) {
            throw new Error('Pool is not connected. Call connect() first.');
        }

        const client = this.clients[this.nextClientIndex];

        // Move the pointer to the next client for the next request
        this.nextClientIndex = (this.nextClientIndex + 1) % this.clients.length;

        return client;
    }

    /**
     * ENTRY POINT: Creates a CommandBuilder using a scheduled client.
     * Usage is identical to single MikrotikClient.
     */
    public command<T extends Record<string, any> = any>(path: string): CommandBuilder<T> {
        // Here is the magic: We pick a client NOW, and the builder stays tied to it.
        const selectedClient = this.getScheduledClient();
        return new CommandBuilder<T>(selectedClient, path);
    }

    /**
     * RAW COMMAND: Executes a raw command using a scheduled client.
     */
    public write(command: string, parameters?: Record<string, any>): Promise<any[]> {
        return this.getScheduledClient().write(command, parameters);
    }

    /**
     * STREAM: Starts a stream on a scheduled client.
     * * Warning: Heavy streaming on all pool sockets might saturate the pool.
     */
    public stream(
        command: string,
        parameters: Record<string, any> | undefined,
        callback: (data: any) => void
    ): Subscription {
        return this.getScheduledClient().stream(command, parameters, callback);
    }
}