import * as dotenv from 'dotenv';
import {Auth} from '../core/Auth';
import { EventEmitter } from 'events';
import {SocketClient, SocketClientOptions} from "../core/SocketClient";
import {RosProtocol} from "../core/RosProtocol";
import {ResultParser} from './ResultParser';
import {CommandBuilder} from "./CommandBuilder";
import {SchemaMapper} from '../core/SchemaMapper';
import {RateLimiter} from '../core/RateLimiter';
import {CircuitBreaker, CircuitBreakerOptions} from '../core/CircuitBreaker';
import {FileManager} from '../features/FileManager';
import {PrometheusExporter, MetricDefinition} from '../features/PrometheusExporter';
import {LiveCollection, SnapshotCallback} from "../features/LiveCollection";
import {SnapshotSubscription} from "./SnapshotSubscription";
import {MikrotikTransaction} from "./MikrotikTransaction";
import {RestProtocol} from "../core/RestProtocol";

// Load environment variables immediately
dotenv.config();

export interface MikrotikOptions extends SocketClientOptions {
    /**
     * RouterOS username (default: 'admin')
     */
    user?: string;
    /**
     * RouterOS password (default: empty)
     */
    password?: string;
    /**
     * Set to true to bypass the .env requirement.
     * WARNING: This is highly discouraged for production environments.
     */
    allowInsecureConfig?: boolean;
    /**
     * Maximum commands per second allowed before throttling occurs.
     * Default: 50
     */
    rateLimit?: number;
    /**
     * Configuration for the Circuit Breaker (Fault Tolerance).
     * Defines when to stop trying to connect to a dead router.
     */
    circuitBreaker?: CircuitBreakerOptions;

    protocol?: 'socket' | 'rest';

    /**
     * Secondary port for Socket API (API-SSL).
     * Required only when using 'rest' protocol if you want to use .onSnapshot().
     * Default: undefined
     */
    socketPort?: number;
}

/**
 * Subscription Handle.
 * Returned when starting a stream, allows the user to stop it later.
 */
export interface Subscription {
    stop: () => Promise<void>;
}

/**
 * Internal interface to track pending operations.
 */
interface PendingCommand {
    resolve?: (data: any[]) => void;
    reject: (error: Error) => void;
    data: any[]; // Accumulator for standard commands

    // STREAMING FLAGS
    isStream: boolean;
    onData?: (data: any) => void; // Callback for live data

    // PERFORMANCE MONITORING
    startTime: number; // Timestamp to calculate RTT (Round Trip Time)
    tag: string;
}


export interface IWriteOptions {
    idempotent?: boolean;
    idempotencyKey?: string;
}


export declare interface MikrotikClient {
    on(event: 'close', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'timeout', listener: () => void): this;
    on(event: 'ready', listener: () => void): this;
}

/**
 * MikrotikClient
 * * The Enterprise Facade.
 * This class acts as the central entry point for all RouterOS interactions.
 * It automatically handles connection pooling, security enforcement,
 * hardware protection (rate limiting), and fault tolerance (circuit breaking).
 */
export class MikrotikClient extends EventEmitter {
    private readonly socket: SocketClient | null = null;
    private readonly options: MikrotikOptions;
    private readonly isConfigFromEnv: boolean = false;
    private readonly rest: RestProtocol | null = null;

    private _isConnected: boolean = false;
    private isManuallyClosing: boolean = false;

    private activeLiveCollections = new Map<string, LiveCollection<any>>();

    // --- PUBLIC MODULES (Facade) ---

    /**
     * File Manager Module.
     * Use this to upload/download scripts, backups, and configs.
     * @example client.files.upload('script.rsc', '...');
     */
    public readonly files: FileManager;

    /**
     * The Auto-Topology Engine.
     * Contains information about the RouterOS version, architecture, and smart paths.
     */
    public readonly schema: SchemaMapper = new SchemaMapper();

    // --- INTERNAL ENGINES ---

    /**
     * Traffic Controller (Token Bucket).
     * Protects the router CPU by throttling requests during high load.
     */
    private rateLimiter: RateLimiter;

    /**
     * Fault Tolerance System.
     * Stops execution if the router becomes unresponsive to prevent cascading failures.
     */
    private breaker: CircuitBreaker;

    /**
     * Maps a unique tag (e.g., "t1") to a pending Promise/Stream.
     */
    private pendingCommands = new Map<string, PendingCommand>();

    /**
     * Temporary storage for the current sentence being built word-by-word.
     */
    private currentSentence: Record<string, any> = {};

    /**
     * **MikroTik Client Initializer**
     *
     * Creates a new connection instance to a MikroTik RouterOS device.
     * This constructor implements a **"Secure-by-Default"** philosophy, initializing
     * the TCP/TLS socket, Rate Limiter, and Circuit Breaker subsystems.
     *
     * **Configuration Priority:**
     * 1. **Environment Variables:** `MIKROTIK_HOST`, `MIKROTIK_USER`, etc. (Recommended for Production).
     * 2. **Constructor Options:** Explicit values passed here override defaults but yield to Env Vars if present.
     *
     * @param options Configuration object defining connection, security, and stability parameters.
     *
     * @example
     * // =================================================================
     * // SCENARIO 1: LOCAL TESTING / DEVELOPMENT (Your Example)
     * // =================================================================
     * // Hardcoded credentials are used for quick connectivity testing in the lab.
     * // We enable 'allowInsecureConfig' to silence the security warning.
     * const client = new MikrotikClient({
     * host: '192.168.0.1',       // Local Lab IP
     * user: 'admin',              // Admin User
     * password: 'admin',       // Password (exposed in code)
     * port: 8728,                 // Standard API Port (Non-Encrypted)
     * useTLS: false,              // Disable SSL for local speed/simplicity
     * rateLimit: 50,              // Limit concurrency to 50 commands
     * allowInsecureConfig: true,  // REQUIRED: Suppresses "Hardcoded Password" warning
     * });
     *
     * @example
     * // =================================================================
     * // SCENARIO 2: PRODUCTION / DEPLOYMENT (Best Practice)
     * // =================================================================
     * // 1. Credentials are removed from code (loaded from .env file or Docker secrets).
     * // 2. TLS encryption is enabled to protect passwords over the network.
     * // 3. Circuit Breaker is configured for high availability.
     * const prodClient = new MikrotikClient({
     * // Credentials are NOT here. They are read from:
     * // process.env.MIKROTIK_HOST, process.env.MIKROTIK_USER, etc.
     *
     * useTLS: true,               // Force Encryption (Port 8729)
     * rejectUnauthorized: false,  // Set false if using Self-Signed Certs (Standard in MikroTik)
     * allowInsecureConfig: false, // Enforce security: Warn if credentials accidentally appear in code
     *
     * timeout: 15,                // Wait max 15s for response (vs 10s default)
     * rateLimit: 100,             // Higher throughput for production
     * * circuitBreaker: {           // Protect system if router dies
     * failureThreshold: 5,    // Fail after 5 errors
     * resetTimeout: 30000     // Retry connection after 30 seconds
     * }
     * });
     */
    constructor(options: MikrotikOptions) {
        super();

        // Environment Variable Resolution
        const envHost = process.env.MIKROTIK_HOST;
        const envUser = process.env.MIKROTIK_USER;
        const envPass = process.env.MIKROTIK_PASS;
        const envPort = process.env.MIKROTIK_PORT;
        const envProtocol = process.env.MIKROTIK_PROTOCOL;
        const envSocketPort = process.env.MIKROTIK_PORT_APISSL;

        this.isConfigFromEnv = !!(envHost && envUser && envPass);

        // Configuration Merging
        this.options = {
            host: envHost || options.host,
            user: envUser || options.user,
            password: envPass || options.password,
            port: envPort ? Number(envPort) : options.port,
            protocol: (envProtocol as 'socket' | 'rest') || options.protocol || 'socket',
            socketPort: envSocketPort ? Number(envSocketPort) : options.socketPort,
            useTLS: options.useTLS ?? false,
            rejectUnauthorized: options.rejectUnauthorized ?? false,
            allowInsecureConfig: options.allowInsecureConfig ?? false,
            timeout: options.timeout || 10,
            rateLimit: options.rateLimit || 50,
        };

        // Initialize Sub-Systems
        this.rateLimiter = new RateLimiter(this.options.rateLimit || 50);
        this.breaker = new CircuitBreaker(options.circuitBreaker);
        this.files = new FileManager(this);

        // 4. Security Audit
        if (!this.isConfigFromEnv && this.options.allowInsecureConfig) {
            this.printSeriousWarning();
        }

        if (this.options.protocol === 'rest') {
            const targetPort = this.options.port === 8728 ? 443 : (this.options.port || 443);

            this.rest = new RestProtocol({
                host: this.options.host!,
                user: this.options.user || 'admin',
                pass: this.options.password || '',
                port: targetPort,
                timeout: (this.options.timeout ?? 10) * 1000,
                insecure: !this.options.rejectUnauthorized
            });
        }

        const shouldInitSocket = this.options.protocol === 'socket' ||
            (this.options.protocol === 'rest' && !!this.options.socketPort);

        if (shouldInitSocket) {
            const socketTargetPort = this.options.protocol === 'socket'
                ? (this.options.port || 8728)
                : this.options.socketPort!;

            this.socket = new SocketClient({
                host: this.options.host!,
                port: socketTargetPort,
                useTLS: this.options.useTLS,
                rejectUnauthorized: this.options.rejectUnauthorized
            });
        } else {
            this.socket = null;
        }
    }


    public get isConnected(): boolean {
        return this._isConnected;
    }

    /**
     * **Smart Connection Manager**
     *
     * Establishes the connection to the Router based on the selected protocol strategy.
     *
     * **Logic Flow:**
     * 1. **Security Audit:** Ensures no hardcoded credentials in production.
     * 2. **Circuit Breaker:** Wraps the entire sequence to handle network failures.
     * 3. **Protocol Negotiation:**
     * - **REST Mode (v7+):** Connects via HTTPS first. Loads schema instantly.
     * If a secondary socket port is configured (for `.onSnapshot`), it
     * establishes a background TCP tunnel solely for streaming.
     * - **Socket Mode (v6):** Establishes TCP connection, performs MD5/CHAP login,
     * and then loads the schema.
     */
    public async connect(): Promise<void> {
        this.isManuallyClosing = false;

        // Security Check
        if (!this.isConfigFromEnv && !this.options.allowInsecureConfig) {
            throw new Error('FATAL: Insecure Configuration. Use .env or allowInsecureConfig: true');
        }

        // Execution (Protected by Circuit Breaker)
        await this.breaker.execute(async () => {

            // --- STRATEGY A: REST API (Modern / Hybrid) ---
            if (this.rest && this.options.protocol === 'rest') {
                // Step A1: Establish Main Control Channel (HTTPS)
                await this.rest.connect();

                // Step A2: Initialize Background Stream Channel (Hybrid Mode)
                if (this.socket) {
                    await this.socket.connect();

                    this.socket.on('data', (word: string) => this.processIncomingWord(word));

                    // --- SOCKET EVENTS BRIDGING (REST MODE) ---
                    this.socket.on('close', () => {
                        this._isConnected = false;
                        this.emit('close');

                        if (this.isManuallyClosing) {
                            this.pendingCommands.clear();
                        } else {
                            this.rejectAllCommands(new Error('Stream Connection closed unexpectedly'));
                        }
                    });

                    this.socket.on('error', (err: Error) => {
                        this._isConnected = false;
                        this.emit('error', err);
                        this.rejectAllCommands(err);
                    });

                    // Authenticate background channel
                    await this.login();
                }
            }

            // --- STRATEGY B: SOCKET API (Legacy / Standard) ---
            else if (this.socket) {
                // Step B1: Establish TCP/TLS Connection
                await this.socket.connect();

                // Step B2: Graceful Listener Binding
                this.socket.on('data', (word: string) => this.processIncomingWord(word));

                // --- SOCKET EVENTS BRIDGING (SOCKET MODE) ---
                this.socket.on('close', () => {
                    this._isConnected = false;
                    this.emit('close');

                    if (this.isManuallyClosing) {
                        this.pendingCommands.clear();
                    } else {
                        this.rejectAllCommands(new Error('Connection closed unexpectedly'));
                    }
                });

                this.socket.on('error', (err: Error) => {
                    this._isConnected = false;
                    this.emit('error', err);
                    this.rejectAllCommands(err);
                });

                // Step B3: Handshake & Auth
                await this.login();
            }
            else {
                throw new Error("MikrotikClient: No driver initialized. Check configuration.");
            }

            // POST-CONNECTION SETUP
            await this.schema.load(this);

            // --- FINAL SUCCESS STATE ---
            this._isConnected = true;
            this.emit('ready');
        });
    }


    /**
     * Closes the connection to the router and cleans up resources.
     * Sets the 'isManuallyClosing' flag to prevent false error reports.
     */
    public close(): void {
        this.isManuallyClosing = true;

        this._isConnected = false;
        this.emit('close');

        if (this.socket) {
            this.socket.close();
        }

        if (this.rest) {
            this.rest.close();
        }
    }


    /**
     * Prints a highly visible warning banner to the console.
     */
    private printSeriousWarning(): void {
        const border = "=".repeat(60);
        console.warn(`\n\x1b[33m${border}\x1b[0m`);
        console.warn('\x1b[43m\x1b[30m %s \x1b[0m', ' SERIOUS SECURITY ADVISORY ');
        console.warn('\x1b[33m%s\x1b[0m', 'Using hardcoded credentials. Please use .env file.');
        console.warn(`\x1b[33m${border}\x1b[0m\n`);
    }


    /**
     * **Fluent Command Builder Factory**
     *
     * Creates a new `CommandBuilder` instance for a specific menu path. This is the
     * primary entry point for constructing standard API operations (Read, Write, Remove)
     * using a clean, method-chaining syntax.
     *
     * **Feature: Schema & Alias Resolution**
     * This method automatically passes the input `path` through the internal `SchemaMapper`.
     * This allows you to use configured aliases or short-hands instead of full paths,
     * effectively abstracting hardware or version differences (e.g., RouterOS v6 vs v7).
     *
     * @template T The TypeScript interface of the resource (e.g., `Interface`, `LogEntry`).
     * @param path The full menu path (e.g., `/ip/address`) or a registered alias (e.g., `wifi`).
     * @returns A `CommandBuilder` instance initialized with the resolved path.
     *
     * @example
     * // EXAMPLE 1: Standard Fluent Usage
     * // Chain methods to filter and fetch specific data
     * const droppedPackets = await client.command('/ip/firewall/filter')
     * .where('chain', 'input')
     * .where('action', 'drop')
     * .print();
     *
     * @example
     * // EXAMPLE 2: Using Schema Aliases (Abstraction)
     * // If your SchemaMapper maps 'secrets' to '/ppp/secret':
     * await client.command('secrets').add({
     * name: 'new_user',
     * password: 'secure_password'
     * });
     */
    public command<T extends Record<string, any> = any>(path: string): CommandBuilder<T> {
        const realPath = this.schema.resolve(path);
        return new CommandBuilder<T>(this, realPath);
    }


    /**
     * Initiates a **Multi-Command Transaction**.
     *
     * This method returns a builder that allows you to queue multiple write operations
     * and execute them as a single batch. It is designed to ensure data integrity
     * by preventing "orphan records" in your network configuration.
     *
     * **Execution Modes:**
     * - **Sequential (Default):** Executes commands one by one. If a command fails,
     * the process stops immediately, preventing subsequent commands from running.
     * - **Parallel:** Executes all commands simultaneously using `Promise.all`.
     * Use `.parallel()` for independent bulk operations (e.g., disabling 50 users).
     *
     * @returns A new `MikrotikTransaction` builder instance.
     *
     * @example
     * // Example: Safe User Creation (Sequential)
     * // If creating the PPP Secret fails, the Simple Queue is NEVER created.
     * try {
     * const results = await client.transaction()
     * .add('/ppp/secret/add', { name: 'client_A', profile: '10M' })
     * .add('/queue/simple/add', { name: 'client_A', target: '192.168.1.50' })
     * .commit();
     * * console.log('User and Queue created successfully!');
     * } catch (error) {
     * console.error('Transaction failed/aborted:', error.message);
     * }
     */
    public transaction(): MikrotikTransaction {
        return new MikrotikTransaction(this);
    }


    /**
     * Accesses a **Resource Collection** for reading or streaming.
     *
     * This is the main entry point for data manipulation. It returns a fluent builder
     * that allows you to filter data, fetch it once with advanced transformations,
     * or subscribe to real-time updates using a single shared connection (Singleton).
     *
     * **Features:**
     * - **Filtering:** Chain `.where()` to filter data server-side.
     * - **Reporting:** Use `.print()` to get a `MikrotikCollection` (supports `.toPages()`, `.toMap()`, etc.).
     * - **Streaming:** Use `.onSnapshot()` to get a `SnapshotSubscription` (supports `.onDiff()`, `.throttle()`).
     *
     * @template T The interface of the resource (e.g., `PPPSecret`, `Interface`).
     * @param path The MikroTik menu path (e.g., `/ppp/active`, `/log`, `/interface`).
     * @returns A fluent builder object with `where()`, `print()`, and `onSnapshot()` methods.
     *
     * @example
     * // EXAMPLE 1: Fetch & Transform (One-off)
     * // Get page 2 of active PPPoE users, grouped by profile
     * const report = await client.collection<PPPActive>('/ppp/active')
     * .where('service', 'pppoe')
     * .print()
     * .then(col => col.toGrouped('profile'));
     *
     * @example
     * // EXAMPLE 2: Real-time Monitoring (Streaming)
     * // Listen for changes, receiving only diffs (added/removed) every 500ms
     * const sub = client.collection('/log')
     * .onSnapshot(diff => console.log('Log Update:', diff))
     * .onDiff()      // Receive { added, removed } instead of full list
     * .throttle(500); // Optimize CPU by grouping updates
     */
    public collection<T extends Record<string, any> = Record<string, any>>(path: string) {
        const query: Record<string, string | number | boolean> = {};

        const builder = {
            where: (key: string, value: string | number | boolean) => {
                query[key] = value;
                return builder;
            },

            print: async () => {
                const cmd = new CommandBuilder<T>(this, path);
                Object.keys(query).forEach(k => cmd.where(k, query[k]));
                return cmd.print();
            },

            /**
             * Subscribes to changes on this collection. Unlike standard listeners, this method
             * returns a smart `SnapshotSubscription` that allows you to apply client-side
             * intelligence like Diffing, Throttling, and Joining.
             *
             * **Efficiency Note (Singleton Pattern):**
             * This method checks if a connection for this specific path+query already exists.
             * If multiple parts of your app listen to `/ppp/active`, they will share
             * a **single physical socket connection** to the router, saving massive CPU/Bandwidth.
             *
             * @param callback Function to execute. Can receive the full array OR a Diff object.
             * @returns A `SnapshotSubscription` object for chaining `.onDiff()`, `.throttle()`, etc.
             *
             * @example
             * // SCENARIO 1: Simple Dashboard (Full List)
             * // Updates the UI with the full list of active users every time something changes.
             * const sub = client.collection('/ppp/active')
             * .onSnapshot((users) => {
             * console.log(`Total users: ${users.length}`);
             * updateTable(users);
             * });
             *
             * @example
             * // SCENARIO 2: High-Performance Monitoring (Diffs + Throttle)
             * // ideal for logs or high-frequency tables.
             * // - '.onDiff()': Receive only { added, removed, modified }
             * // - '.throttle(1000)': Update max once per second
             * const sub = client.collection('/log')
             * .onSnapshot((diff) => {
             * // TypeScript knows this is a SnapshotDiff now
             * if ('added' in diff) {
             * diff.added.forEach(log => console.log('New Log:', log.message));
             * }
             * })
             * .onDiff()
             * .throttle(1000);
             */
            onSnapshot: (callback: SnapshotCallback<T>): SnapshotSubscription<T> => {
                const cacheKey = `${path}:${JSON.stringify(query)}`;

                let liveCol = this.activeLiveCollections.get(cacheKey);

                if (!liveCol) {
                    liveCol = new LiveCollection<T>(this, path, query);
                    this.activeLiveCollections.set(cacheKey, liveCol);
                }

                return liveCol.onSnapshot(callback);
            }
        };

        return builder;
    }


    /**
     * **Prometheus Exporter Helper**
     *
     * Fetches data from a specific menu path and immediately converts it into
     * the standard Prometheus text format. This is ideal for exposing a `/metrics`
     * endpoint in your Express/Fastify application to monitor router health.
     *
     * @param path The MikroTik menu path to query (e.g., `/system/resource`, `/interface/print`).
     * @param metrics An array of metric definitions mapping MikroTik fields to Prometheus metrics.
     * @param params Optional command parameters (e.g., `{ 'count-only': 'true' }`).
     * @returns A Promise resolving to a string formatted for Prometheus scraping.
     *
     * @example
     * // Example: Exposing CPU and Memory usage
     * const output = await client.getMetrics('/system/resource', [
     * {
     * name: 'mikrotik_cpu_load',
     * help: 'Current CPU usage percentage',
     * type: 'gauge',
     * valueField: 'cpu-load' // Field from MikroTik response
     * },
     * {
     * name: 'mikrotik_free_memory',
     * help: 'Free memory in bytes',
     * type: 'gauge',
     * valueField: 'free-memory'
     * }
     * ]);
     *
     * // Result (String):
     * // # HELP mikrotik_cpu_load Current CPU usage percentage
     * // # TYPE mikrotik_cpu_load gauge
     * // mikrotik_cpu_load{host="192.168.88.1"} 12
     */
    public async getMetrics(
        path: string,
        metrics: MetricDefinition[],
        params?: Record<string, any>
    ): Promise<string> {
        const data = await this.command(path).print(params);
        return PrometheusExporter.export(data, metrics);
    }


    /**
     * **Core Execution Method (Low-Level API)**
     *
     * Sends a raw command to the RouterOS API via the active protocol (Socket or REST).
     *
     * **Architecture Layers:**
     * 1.  **Circuit Breaker:** Prevents cascading failures.
     * 2.  **Rate Limiter:** Implements congestion control.
     * 3.  **Protocol Adapter:** Automatically routes traffic to REST (v7) or Socket (v6).
     *
     * @param command The full command path (e.g., `/ip/address/add`).
     * @param parameters Key-value pairs for command arguments.
     * @returns A Promise that resolves with the raw array response from the router.
     */
    public async write(
        command: string,
        parameters?: Record<string, string | boolean | number>,
        options?: IWriteOptions
    ): Promise<any[]> {

        // Execute the whole flow inside the Circuit Breaker
        return this.breaker.execute(async () => {

            // Wait for Rate Limiter Token (Smart Backoff)
            await this.rateLimiter.acquire();

            // -------------------------------------------------------
            // STRATEGY A: REST API (RouterOS v7+) - PRIORITY
            // -------------------------------------------------------
            // We check 'this.rest' AND verify the intended protocol is 'rest'.
            if (this.rest && this.options.protocol === 'rest') {
                try {
                    // Execute via HTTP, passing BOTH idempotency options
                    const result = await this.rest.command(command, parameters, {
                        idempotent: options?.idempotent,
                        idempotencyKey: options?.idempotencyKey
                    });

                    // REST COMPATIBILITY LAYER:
                    // 1. Handle 204 No Content (null) -> Return empty array [] (Standard Socket behavior for !done)
                    if (result === null) return [];

                    // 2. Wrap single objects in Array
                    // The standard Socket API always returns an Array [{}, {}].
                    // REST often returns a single Object {}. We unify this here so the App Layer doesn't care.
                    return Array.isArray(result) ? result : [result];

                } catch (error) {
                    throw error; // CircuitBreaker catches this to update health stats
                }
            }

            // -------------------------------------------------------
            // STRATEGY B: SOCKET API (Legacy / RouterOS v6)
            // -------------------------------------------------------
            // This block executes ONLY if:
            // 1. Protocol is 'socket' (Legacy Mode)
            // 2. REST failed to initialize (Fallback)
            // In Hybrid Mode, we intentionally skip this for writes.
            if (this.socket) {
                // Note: Socket protocol currently does not natively support "Logical Idempotency"
                // in this library layer. It will behave standardly (throwing error on duplicates).

                return new Promise<any[]>((resolve, reject) => {
                    const tag = this.generateTag();

                    // Parameters are processed normally
                    const payload = this.buildPayload(command, parameters, tag);

                    this.pendingCommands.set(tag, {
                        resolve,
                        reject,
                        data: [],
                        isStream: false,
                        startTime: Date.now(),
                        tag
                    });

                    this.sendPayload(payload);
                });
            }

            throw new Error("MikrotikClient: No protocol driver initialized (Socket or REST).");
        });
    }

    /**
     * **Core Streaming Method (Low-Level API)**
     *
     * Initiates a persistent, long-running operation on the router (e.g., `/tool/torch`, `/listen`,
     * or `/interface/monitor-traffic`). Unlike `write()`, this method keeps the channel open
     * and fires the callback continuously as data packets arrive.
     *
     * **Architecture:**
     * 1.  **Tagging:** Generates a unique, short-lived tag (e.g., `.t1`) to map response packets to this specific callback.
     * 2.  **Rate Limiting:** The start command waits for a slot in the `RateLimiter` to prevent flooding.
     * 3.  **Emergency Stop:** The returned `stop()` method bypasses the rate limiter to execute
     * `/cancel` immediately, ensuring stuck streams can be killed instantly.
     *
     * @param commandOrLines The command path (e.g., `/tool/torch`) or a raw array of protocol lines.
     * @param parameters Optional arguments (e.g., `{ interface: 'ether1' }`).
     * @param callback The function to execute for every data packet received.
     * @returns A `Subscription` object containing the `.stop()` method to terminate the stream.
     *
     * @example
     * // Example: Live Traffic Monitoring
     * const trafficStream = client.stream(
     * '/interface/monitor-traffic',
     * { interface: 'ether1', 'traffic': 'true' },
     * (packet) => {
     * console.log(`RX: ${packet['rx-bits-per-second']}, TX: ${packet['tx-bits-per-second']}`);
     * }
     * );
     *
     * // Stop monitoring after 10 seconds
     * setTimeout(() => {
     * trafficStream.stop().then(() => console.log('Monitoring stopped.'));
     * }, 10000);
     */
    public stream(
        commandOrLines: string | string[],
        parameters: Record<string, string | boolean | number> | undefined,
        callback: (data: any) => void
    ): Subscription {
        // Generate the tag upfront so we can return the handle immediately
        const tag = this.generateTag();

        // Queue the start command (respecting rate limits)
        this.rateLimiter.acquire().then(() => {
            let payload: string[];

            if (Array.isArray(commandOrLines)) {
                payload = [...commandOrLines];
                // Ensure tag is present
                if (!payload.some(l => l.startsWith('.tag='))) {
                    payload.push(`.tag=${tag}`);
                }
            } else {
                payload = this.buildPayload(commandOrLines, parameters, tag);
            }

            this.pendingCommands.set(tag, {
                reject: (err) => console.error(`Stream error [${tag}]:`, err),
                data: [],
                isStream: true,
                onData: callback,
                startTime: Date.now(),
                tag
            });

            this.sendPayload(payload);
        });

        // Return the handle to stop this specific stream tag
        return {
            stop: async () => {
                // Emergency stop bypasses rate limiter for immediate effect
                await this.writeInternal('/cancel', {'tag': tag});
            }
        };
    }

    // ========================================================
    // PRIVATE HELPERS
    // ========================================================

    private generateTag(): string {
        return 't' + Math.random().toString(36).substring(2, 9);
    }

    private buildPayload(command: string, params: any, tag: string): string[] {
        const payload = [command];
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                // Determine prefix: Queries ('?') vs Attributes ('=')
                const prefix = key.startsWith('?') ? '' : '=';
                payload.push(`${prefix}${key}=${value}`);
            }
        }
        payload.push(`.tag=${tag}`);
        return payload;
    }

    private sendPayload(payload: string[]) {
        if (!this.socket) {
            console.error("MikrotikClient Error: Attempted to send payload via inactive socket. Check 'socketPort' config.");
            return;
        }

        for (const word of payload) {
            this.socket.write(RosProtocol.encodeSentence(word));
        }
        this.socket.write(RosProtocol.encodeSentence(''));
    }

    private async login(): Promise<void> {
        return new Promise(async (resolve, reject) => {
            try {
                // Use writeInternal to bypass CircuitBreaker/RateLimiter during handshake
                const response = await this.writeInternal('/login', {
                    name: this.options.user || '',
                    password: this.options.password || ''
                });
                const lastMsg = response[response.length - 1] || {};

                if (lastMsg['ret']) {
                    const challenge = lastMsg['ret'];
                    const md5Response = Auth.calculateLegacyMD5(this.options.password || '', challenge);

                    await this.writeInternal('/login', {
                        name: this.options.user || '',
                        response: md5Response
                    });
                }
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Raw write method bypassing protection layers.
     * Used for Login and Emergency Cancel.
     */
    private writeInternal(command: string, parameters?: any): Promise<any[]> {
        return new Promise((resolve, reject) => {
            const tag = this.generateTag();
            const payload = this.buildPayload(command, parameters, tag);

            this.pendingCommands.set(tag, {
                resolve,
                reject,
                data: [],
                isStream: false,
                startTime: Date.now(),
                tag
            });
            this.sendPayload(payload);
        });
    }

    private processIncomingWord(word: string): void {
        if (word.length === 0) {
            this.routeSentence(this.currentSentence);
            this.currentSentence = {};
            return;
        }

        if (word.startsWith('!')) this.currentSentence['!type'] = word;
        else if (word.startsWith('.tag=')) this.currentSentence['.tag'] = word.substring(5);
        else if (word.startsWith('=')) {
            const parts = word.substring(1).split('=');
            this.currentSentence[parts[0]] = parts.slice(1).join('=');
        } else if (word.startsWith('ret=')) {
            this.currentSentence['ret'] = word.substring(4);
        } else {
            this.currentSentence[word] = true;
        }
    }

    /**
     * THE CORE ROUTING LOGIC
     */
    private routeSentence(sentence: Record<string, any>) {
        const tag = sentence['.tag'];
        const type = sentence['!type'];

        if (!tag || !this.pendingCommands.has(tag)) return;
        const cmd = this.pendingCommands.get(tag)!;

        // DATA PACKET (!re)
        if (type === '!re') {
            const cleanObj = {...sentence};
            delete cleanObj['!type'];
            delete cleanObj['.tag'];

            if (cmd.isStream && cmd.onData) {
                // Streaming: Emit data immediately
                const parsed = ResultParser.parse([cleanObj])[0];
                cmd.onData(parsed);
            } else {
                // Standard: Buffer data
                cmd.data.push(cleanObj);
            }
        }
        // COMPLETION PACKET (!done)
        else if (type === '!done') {
            // --- HEALTH FEEDBACK ---
            const duration = Date.now() - cmd.startTime;
            this.rateLimiter.submitFeedback(duration);
            // -----------------------

            if (!cmd.isStream && cmd.resolve) {
                if (cmd.data.length === 0 && Object.keys(sentence).length > 2) {
                    const cleanObj = {...sentence};
                    delete cleanObj['!type'];
                    delete cleanObj['.tag'];
                    cmd.data.push(cleanObj);
                }
                cmd.resolve(ResultParser.parse(cmd.data));
            }
            this.pendingCommands.delete(tag);
        }
        // ERROR PACKET (!trap)
        else if (type === '!trap') {
            const duration = Date.now() - cmd.startTime;
            this.rateLimiter.submitFeedback(duration);

            const errorMsg = sentence['message'] || 'Unknown MikroTik Error';

            if (errorMsg.includes('interrupted')) {
                this.pendingCommands.delete(tag);
                return;
            }

            cmd.reject(new Error(errorMsg));
            this.pendingCommands.delete(tag);
        }
    }

    private rejectAllCommands(error: Error) {
        for (const [tag, cmd] of this.pendingCommands) {
            cmd.reject(error);
        }
        this.pendingCommands.clear();
    }
}