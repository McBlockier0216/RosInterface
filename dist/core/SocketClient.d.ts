import { EventEmitter } from 'events';
import { Buffer } from 'buffer';
export interface SocketClientOptions {
    host: string;
    port: number;
    timeout?: number;
    useTLS?: boolean;
    rejectUnauthorized?: boolean;
    keepAlive?: boolean;
}
export declare class SocketClient extends EventEmitter {
    private socket;
    private options;
    connected: boolean;
    private receiveBuffer;
    constructor(options: SocketClientOptions);
    connect(): Promise<void>;
    write(data: Buffer): void;
    close(): void;
    destroy(): void;
    private cleanup;
    private handleDataChunk;
}
