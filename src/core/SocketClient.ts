import * as net from 'net';
import * as tls from 'tls';
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';
import { RosProtocol } from './RosProtocol'; // Asegúrate de tener este archivo

/**
 * Configuration options for the Socket Client.
 */
export interface SocketClientOptions {
    /** Target IP address or Hostname */
    host: string;
    /** Target Port (default: 8728 for plain, 8729 for SSL) */
    port: number;
    /** Connection timeout in seconds (default: 10) */
    timeout?: number;
    /** Enable SSL/TLS encryption (default: false) */
    useTLS?: boolean;
    /** If true, allows self-signed certificates (default: false) */
    rejectUnauthorized?: boolean;
    /** Enable TCP Keep-Alive to prevent idle disconnects (default: true) */
    keepAlive?: boolean;
}

/**
 * Low-level TCP/TLS Client.
 * Responsibilities:
 * 1. Transport Layer: Decides between 'net' (Plain) and 'tls' (Secure).
 * 2. Event Handling: Manages socket errors, closures, and timeouts.
 * 3. Framing: Buffers incoming raw bytes and splits them into valid MikroTik words.
 */
export class SocketClient extends EventEmitter {
    // Union type to support both standard and secure sockets
    private socket: net.Socket | tls.TLSSocket | null = null;
    private options: SocketClientOptions;

    // State tracking
    public connected: boolean = false;

    // Buffer accumulator for handling TCP packet fragmentation
    private receiveBuffer: Buffer = Buffer.alloc(0);

    constructor(options: SocketClientOptions) {
        super();
        this.options = {
            timeout: 10,
            rejectUnauthorized: false, // For development usually
            keepAlive: true,
            useTLS: false,
            ...options
        };
    }

    /**
     * Establishes the connection to the router.
     * Supports both Plain TCP and TLS based on configuration.
     * @returns Promise that resolves when the connection is fully established.
     */
    public connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.connected) return resolve();

            // 1. Clean up any previous socket instance
            this.cleanup();

            // 2. Calculate timeout in milliseconds
            const timeoutMs = (this.options.timeout || 10) * 1000;

            // 3. LOGIC DECISION: TLS vs PLAIN TCP
            try {
                if (this.options.useTLS) {
                    // --- SECURE MODE (TLS) ---
                    const tlsOptions: tls.ConnectionOptions = {
                        host: this.options.host,
                        port: this.options.port,
                        rejectUnauthorized: this.options.rejectUnauthorized,
                        timeout: timeoutMs
                    };
                    this.socket = tls.connect(tlsOptions);
                } else {
                    // --- PLAIN MODE (TCP) ---
                    this.socket = new net.Socket();
                    this.socket.setTimeout(timeoutMs);
                    this.socket.connect(this.options.port, this.options.host);
                }
            } catch (err) {
                return reject(err);
            }

            // 4. Handle Connection Timeout (Handshake phase)
            this.socket.once('timeout', () => {
                const err = new Error(`Connection timed out after ${this.options.timeout} seconds`);
                this.destroy();
                reject(err);
            });

            // 5. Optimization: Disable Nagle's Algorithm (Lower latency for small packets)
            this.socket.setNoDelay(true);

            // 6. Keep-Alive
            if (this.options.keepAlive && this.socket instanceof net.Socket) {
                this.socket.setKeepAlive(true, 10000);
            }

            // --- EVENT BINDING ---

            const connectEvent = this.options.useTLS ? 'secureConnect' : 'connect';

            this.socket.once(connectEvent, () => {
                this.connected = true;
                // Clear initial timeout so we don't disconnect during operation
                if (this.socket) this.socket.setTimeout(0);

                this.emit('connect'); // Notify MikrotikClient
                resolve();
            });

            this.socket.on('error', (err) => {
                // If error happens during connection phase, reject the promise
                if (!this.connected) {
                    reject(err);
                } else {
                    this.emit('error', err);
                }
            });

            this.socket.on('close', (hadError) => {
                this.connected = false;
                this.emit('close', hadError);
            });

            // DATA RECEIVING LOOP
            this.socket.on('data', (chunk: Buffer | string) => {
                // Defensive programming
                const bufferChunk = Buffer.isBuffer(chunk)
                    ? chunk
                    : Buffer.from(chunk, 'utf8');

                this.handleDataChunk(bufferChunk);
            });
        });
    }

    /**
     * Writes raw bytes to the socket stream.
     */
    public write(data: Buffer): void {
        if (!this.connected || !this.socket) {
            throw new Error('Socket is not connected. Call connect() first.');
        }

        // Uncomment to see OUTGOING raw bytes
        // console.log('>>> OUT [Buffer]:', data);

        this.socket.write(data);
    }

    /**
     * Gracefully closes the connection.
     */
    public close(): void {
        if (this.socket && !this.socket.destroyed) {
            this.socket.end();
            this.connected = false;
        }
    }

    /**
     * Forcefully destroys the connection.
     */
    public destroy(): void {
        if (this.socket && !this.socket.destroyed) {
            this.socket.destroy();
            this.connected = false;
        }
    }

    private cleanup() {
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.destroy();
            this.socket = null;
        }
        this.receiveBuffer = Buffer.alloc(0);
    }

    /**
     * CORE LOGIC: TCP Framing.
     * Extracts valid MikroTik "Words" from the TCP stream.
     */
    private handleDataChunk(chunk: Buffer): void {
        // Append new data
        this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk]);

        // Loop to process as many words as possible
        while (this.receiveBuffer.length > 0) {

            // Decode length using RosProtocol utility
            const lengthInfo = RosProtocol.decodeLength(this.receiveBuffer);

            // If we don't have enough bytes for the length header, wait for next packet
            if (!lengthInfo) {
                break;
            }

            const { length, byteLength } = lengthInfo;
            const totalPacketSize = byteLength + length;

            // If we have the header but not the full body, wait.
            if (this.receiveBuffer.length < totalPacketSize) {
                break;
            }

            const payload = this.receiveBuffer.slice(byteLength, totalPacketSize);

            this.receiveBuffer = this.receiveBuffer.slice(totalPacketSize);

            const word = payload.toString('utf8');

            this.emit('data', word);
        }
    }
}