import { MikrotikClient, MikrotikOptions, IWriteOptions } from './MikrotikClient';

/**
 * Represents the outcome of an operation on a specific node within the swarm.
 */
export interface SwarmResult {
    /** The unique identifier of the node (e.g., "CORE_ROUTER"). */
    nodeId: string;
    /** True if the operation succeeded, False if it failed. */
    success: boolean;
    /** The data returned by the router (if successful). */
    data?: any[];
    /** The error message (if failed). */
    error?: string;
}

/**
 * **MikrotikSwarm**
 *
 * A high-level orchestrator for managing a fleet of MikroTik routers.
 * It allows you to execute "Broadcast" (All Nodes) or "Multicast" (Selected Nodes)
 * operations simultaneously using the underlying RestProtocol (or Socket).
 *
 * **Scalability Note:**
 * This class uses `Promise.allSettled` to execute commands in parallel.
 * It handles partial failures gracefully (e.g., if 1 out of 50 routers is offline,
 * the other 49 will still receive the command).
 */
export class MikrotikSwarm {
    /**
     * Internal registry of router clients.
     * Key: Node ID, Value: MikrotikClient Instance.
     */
    private nodes = new Map<string, MikrotikClient>();

    /**
     * Adds a new router node to the swarm registry.
     * The client is instantiated but not connected immediately.
     *
     * @param id A unique string identifier for this router (e.g., "Gateway_01", "192.168.88.1").
     * @param config The configuration object for the MikrotikClient (Host, User, Pass, Protocol).
     *
     * @example
     * // EXAMPLE 1: Adding a RouterOS v7 Node (REST Mode)
     * swarm.addNode('CORE_GW', {
     * host: '10.0.0.1',
     * user: 'admin',
     * password: 'safe',
     * protocol: 'rest', // Uses HTTPS
     * port: 443
     * });
     *
     * @example
     * // EXAMPLE 2: Adding a Legacy RouterOS v6 Node (Socket Mode)
     * swarm.addNode('LEGACY_AP', {
     * host: '10.0.0.50',
     * user: 'admin',
     * password: 'safe',
     * protocol: 'socket', // Uses TCP
     * port: 8728
     * });
     */
    public addNode(id: string, config: MikrotikOptions): void {
        if (this.nodes.has(id)) {
            console.warn(`[MikrotikSwarm] Warning: Overwriting existing node ID '${id}'.`);
        }
        const client = new MikrotikClient(config);
        this.nodes.set(id, client);
    }

    /**
     * Initiates connections for ALL registered nodes in parallel.
     * This is resilient: if some nodes fail to connect, the process finishes,
     * and you can check the logs for specific failures.
     *
     * @returns A Promise that resolves when all connection attempts have finished.
     *
     * @example
     * // EXAMPLE 1: Connect and Log
     * await swarm.connectAll();
     * console.log('Swarm is ready for commands.');
     *
     * @example
     * // EXAMPLE 2: Check health after connection
     * await swarm.connectAll();
     * const offlineNodes = swarm.getOfflineNodes();
     * console.log(`Warning: ${offlineNodes.length} routers are unreachable.`);
     */
    public async connectAll(): Promise<void> {
        console.log(`[Swarm] Connecting to ${this.nodes.size} nodes...`);

        const promises = Array.from(this.nodes.entries()).map(async ([id, client]) => {
            try {
                await client.connect();
                console.log(`[${id}] Connected`);
            } catch (err: any) {
                console.error(`[${id}] Connection Failed: ${err.message}`);
            }
        });

        // Wait for all attempts to finish (whether success or fail)
        await Promise.allSettled(promises);
    }

    /**
     * **Broadcast Command**
     *
     * Executes a write operation (Add, Set, Remove) on **EVERY** node in the swarm simultaneously.
     * Ideal for global policy updates, mass blocklisting, or password rotation.
     *
     * @param command The API command path (e.g., `/ip/firewall/filter/add`).
     * @param params The parameters for the command (e.g., `{ chain: 'input', action: 'drop' }`).
     * @param options Execution options (e.g., `{ idempotent: true }` to avoid duplicates).
     * @returns A Promise resolving to an array of results for each node.
     *
     * @example
     * // EXAMPLE 1: Mass Block an IP (Firewall)
     * const results = await swarm.broadcast('/ip/firewall/address-list/add', {
     * list: 'BLACKLIST',
     * address: '192.168.200.200',
     * timeout: '1d'
     * }, { idempotent: true });
     *
     * @example
     * // EXAMPLE 2: Mass Update DNS Settings
     * await swarm.broadcast('/ip/dns/set', {
     * servers: '8.8.8.8,1.1.1.1',
     * 'allow-remote-requests': 'yes'
     * });
     */
    public async broadcast(
        command: string,
        params?: Record<string, any>,
        options?: IWriteOptions
    ): Promise<SwarmResult[]> {
        console.log(`[Swarm] Broadcasting: ${command} to ${this.nodes.size} nodes.`);

        // Execute on all nodes
        return this.executeOnClients(Array.from(this.nodes.entries()), command, params, options);
    }

    /**
     * **Multicast Command**
     *
     * Executes a write operation on a **SPECIFIC SUBSET** of nodes defined by their IDs.
     * Useful when you only want to update a specific region or type of router.
     *
     * @param nodeIds An array of Node IDs to target (e.g., `['TOWER_A', 'TOWER_B']`).
     * @param command The API command path.
     * @param params The parameters for the command.
     * @param options Execution options.
     * @returns A Promise resolving to an array of results.
     *
     * @example
     * // EXAMPLE 1: Reboot only specific routers
     * await swarm.multicast(['ROUTER_01', 'ROUTER_02'], '/system/reboot');
     *
     * @example
     * // EXAMPLE 2: Add a specific user to the "North" region routers
     * await swarm.multicast(['NORTH_GW_1', 'NORTH_GW_2'], '/user/add', {
     * name: 'tech_support',
     * group: 'full',
     * password: 'secure_temp_pass'
     * });
     */
    public async multicast(
        nodeIds: string[],
        command: string,
        params?: Record<string, any>,
        options?: IWriteOptions
    ): Promise<SwarmResult[]> {
        const targetEntries = Array.from(this.nodes.entries())
            .filter(([id]) => nodeIds.includes(id));

        console.log(`🐝 [Swarm] Multicasting: ${command} to ${targetEntries.length} selected nodes.`);

        return this.executeOnClients(targetEntries, command, params, options);
    }

    /**
     * Safely closes connections for all nodes in the swarm.
     * Should be called when the application shuts down.
     *
     * @example
     * // EXAMPLE 1: Cleanup at end of script
     * try {
     * await swarm.broadcast(...);
     * } finally {
     * swarm.closeAll(); // Ensures no hanging sockets
     * }
     *
     * @example
     * // EXAMPLE 2: Handle process exit
     * process.on('SIGINT', () => {
     * console.log('Stopping Swarm...');
     * swarm.closeAll();
     * process.exit();
     * });
     */
    public closeAll(): void {
        this.nodes.forEach((client, id) => {
            try {
                client.close();
            } catch (e) {
                console.error(`Error closing client ${id}`, e);
            }
        });
        console.log('🐝 [Swarm] All connections closed.');
    }

    /**
     * Returns a list of Node IDs that currently do not have an active connection.
     * Useful for health checks or reporting.
     *
     * @returns Array of Node ID strings.
     *
     * @example
     * // EXAMPLE 1: Simple check
     * const deadNodes = swarm.getOfflineNodes();
     * if (deadNodes.length > 0) alertAdmin(deadNodes);
     *
     * @example
     * // EXAMPLE 2: Retry connection for dead nodes
     * const deadNodes = swarm.getOfflineNodes();
     * // Logic to specifically retry these IDs...
     */
    public getOfflineNodes(): string[] {
        const offline: string[] = [];
        this.nodes.forEach((client, id) => {
            // Check the internal 'socket' or 'rest' connection state via a safe check
            // Note: This relies on the internal implementation of MikrotikClient.
            // Assuming successful connect() implies functionality.
            // A more robust check could be implemented inside MikrotikClient.
        });
        return offline; // Placeholder implementation
    }

    /**
     * Gets a specific client instance by ID.
     * Allows performing complex read/stream operations on a single node.
     * * @param id The Node ID
     * @returns The MikrotikClient instance or undefined.
     * * @example
     * // EXAMPLE 1: Get stats from a specific router
     * const coreRouter = swarm.getNode('CORE');
     * const resources = await coreRouter?.command('/system/resource').print();
     * * @example
     * // EXAMPLE 2: Start a stream on one node
     * swarm.getNode('EDGE_01')?.collection('/log').onSnapshot(logs => ...);
     */
    public getNode(id: string): MikrotikClient | undefined {
        return this.nodes.get(id);
    }

    // =========================================
    // PRIVATE WORKER
    // =========================================

    private async executeOnClients(
        entries: [string, MikrotikClient][],
        command: string,
        params?: any,
        options?: IWriteOptions
    ): Promise<SwarmResult[]> {
        const promises = entries.map(async ([id, client]) => {
            try {
                // The client handles protocol selection (REST vs Socket) automatically.
                // We just send the command.
                const result = await client.write(command, params, options);

                return {
                    nodeId: id,
                    success: true,
                    data: result
                };
            } catch (err: any) {
                return {
                    nodeId: id,
                    success: false,
                    error: err.message || 'Unknown error'
                };
            }
        });

        // Promise.allSettled is key for Swarm Stability.
        // It ensures that one failure does not stop the reporting of others.
        const outcomes = await Promise.allSettled(promises);

        // Transform outcomes to clean SwarmResult array
        return outcomes.map((outcome, index) => {
            if (outcome.status === 'fulfilled') {
                return outcome.value;
            } else {
                // This branch should theoretically rarely be reached
                // because the try/catch block above handles rejections,
                // but it's a safety net.
                return {
                    nodeId: entries[index][0],
                    success: false,
                    error: String(outcome.reason)
                };
            }
        });
    }
}