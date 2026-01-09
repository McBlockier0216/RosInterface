import { MikrotikClient, Subscription } from './MikrotikClient';
import { camelToKebab } from '../utils/Helpers';
import { MikrotikCollection } from '../utils/MikrotikCollection';
import { OfflineQueue } from '../core/OfflineQueue';

/**
 * Interface for the internal cache storage.
 */
interface CacheEntry {
    data: any[];
    expires: number;
}

/**
 * CommandBuilder.ts
 * * The Fluent Interface Engine with Offline-First Capabilities.
 * * Provides syntax sugar for constructing MikroTik commands.
 * * Supports Real-Time Streaming, Persistent Queueing, and Smart Caching.
 */
export class CommandBuilder<T extends Record<string, any>> {
    private readonly client: MikrotikClient;
    private readonly menuPath: string;

    // Internal storage for query parts
    private queryParams: Record<string, string> = {};
    private propList: string[] = [];

    // Persistence Flag
    private isPersistentRequest: boolean = false;

    // ========================================================
    // STATIC CACHE (Shared across builders)
    // ========================================================
    /**
     * Short-lived cache to prevent read-spamming the router.
     * TTL: 5 Seconds.
     */
    private static queryCache = new Map<string, CacheEntry>();
    private static readonly CACHE_TTL_MS = 5000; // 5s

    constructor(client: MikrotikClient, menuPath: string) {
        this.client = client;
        // Normalize path: Ensure it starts with '/' and doesn't end with '/'
        this.menuPath = menuPath.startsWith('/') ? menuPath : '/' + menuPath;
        if (this.menuPath.endsWith('/') && this.menuPath.length > 1) {
            this.menuPath = this.menuPath.slice(0, -1);
        }
    }

    // ========================================================
    // FLUENT FILTERS
    // ========================================================


    /**
     * Adds a **Query Filter** (Equal Match) to the command.
     *
     * This method appends a filter parameter (`?key=value`) to the API request.
     * Only items matching this condition will be returned or affected.
     *
     * **Feature: Auto-Kebab Case**
     * You can use standard JavaScript camelCase keys. They are automatically converted
     * to MikroTik's kebab-case format.
     * - Input: `macAddress` -> Output: `?mac-address=...`
     * - Input: `rxByte`     -> Output: `?rx-byte=...`
     *
     * @param key The field name to filter by (e.g., 'name', 'disabled', 'macAddress').
     * @param value The value to match. Booleans are converted to 'true'/'false' strings.
     * @returns The current builder instance for chaining.
     *
     * @example
     * // Find a specific user by name
     * client.command('/ppp/secret')
     * .where('name', 'john_doe')
     * .print();
     *
     * @example
     * // Find all disabled interfaces (camelCase supported)
     * client.command('/interface')
     * .where('disabled', true) // Sends ?disabled=true
     * .print();
     */
    public where(key: string, value: string | number | boolean): this {
        const kebabKey = camelToKebab(key);
        const formattedValue = this.formatValue(value);
        this.queryParams[`?${kebabKey}`] = formattedValue;
        return this;
    }


    /**
     * Adds an **Existence Filter** to the command.
     *
     * Matches items where the specified key exists (is defined), regardless of its value.
     * This is useful for finding items that have optional properties set.
     * Corresponds to the MikroTik API syntax `?key=`.
     *
     * @param key The field name to check for existence.
     * @returns The current builder instance for chaining.
     *
     * @example
     * // Find all firewall rules that have a comment
     * client.command('/ip/firewall/filter')
     * .whereExists('comment')
     * .print();
     */
    public whereExists(key: string): this {
        const kebabKey = camelToKebab(key);
        this.queryParams[`?${kebabKey}`] = '';
        return this;
    }


    /**
     * **Field Projection (Optimization)**
     *
     * Restricts the fields returned by the router to a specific list.
     * Using this method significantly reduces CPU load on the router and network bandwidth,
     * especially when querying large tables like the routing table or logs.
     * Corresponds to the MikroTik API argument `.proplist`.
     *
     * **Feature: Auto-Kebab Case**
     * Inputs like `rxByte` are automatically converted to `rx-byte`.
     *
     * @param fields An array of field names to retrieve.
     * @returns The current builder instance for chaining.
     *
     * @example
     * // Get only the name and uptime of active users (ignoring traffic stats)
     * const users = await client.command('/ppp/active')
     * .select(['name', 'uptime', 'callerId']) // optimized request
     * .print();
     */
    public select(fields: string[]): this {
        const kebabFields = fields.map(f => camelToKebab(f));
        this.propList.push(...kebabFields);
        return this;
    }

    // ========================================================
    // PERSISTENCE MODIFIER
    // ========================================================

    /**
     * **Offline Tolerance Strategy**
     *
     * Marks the current command as **Persistent**.
     * Normally, if the router is disconnected, a command fails immediately.
     * With `.persistent()`, the command is added to an internal retry queue
     * and will be executed automatically as soon as the connection is restored.
     *
     * **Use Case:** Critical background tasks (e.g., scheduled billing cuts) that
     * must eventually run, even if the network is currently unstable.
     *
     * @returns The current builder instance.
     * @example
     * // Even if the router is down, this will run when it comes back up.
     * client.command('/system/reboot').persistent().send();
     */
    public persistent(): this {
        this.isPersistentRequest = true;
        return this;
    }

    // ========================================================
    // READ TERMINATORS (With Caching & Source Filtering)
    // ========================================================

    /**
     * **Server-Side Search (Multi-Item)**
     *
     * Executes a search directly on the RouterOS CPU.
     * Unlike client-side filtering, this method instructs the router to filter
     * the data *before* sending it over the network.
     *
     * **Performance Note:**
     * extremely efficient for large tables (like thousands of PPPoE secrets),
     * as only the matching rows travel over the wire.
     *
     * @param criteria An object with key-value pairs to match (e.g., `{ disabled: 'true', profile: 'default' }`).
     * @returns A `MikrotikCollection` containing only the matching items.
     *
     * @example
     * // Fetch all users in the 'default' profile
     * const users = await client.command('/ppp/secret').findBy({ profile: 'default' });
     */
    public async findBy(criteria: Partial<T>): Promise<MikrotikCollection<T>> {
        // Convert criteria object into MikroTik query parameters
        for (const [key, value] of Object.entries(criteria)) {
            this.where(key, value as any);
        }
        // Execute print (which includes cache logic)
        return this.print();
    }

    /**
     * **Server-Side Search (Single-Item)**
     *
     * The most efficient way to retrieve a single specific resource.
     * It applies the filters, executes the query, and returns the first result.
     *
     * @param criteria Unique identifiers (e.g., `{ name: 'admin' }` or `{ macAddress: '00:...' }`).
     * @returns The found item object, or `null` if no match was found.
     *
     * @example
     * // Find a specific interface by name
     * const ether1 = await client.command('/interface').findOne({ name: 'ether1' });
     * if (ether1) console.log(ether1.mac_address);
     */
    public async findOne(criteria: Partial<T>): Promise<T | null> {
        const collection = await this.findBy(criteria);
        return collection.first();
    }

    /**
     * **Execution Terminator: Print with Caching**
     *
     * Finalizes the builder chain and sends the `print` command to the router.
     *
     * **Feature: Smart Caching (TTL 5s)**
     * To prevent flooding the router with redundant read requests (e.g., multiple UI components
     * asking for the same data), this method implements a **Read-Through Cache**.
     * 1.  **Cache Hit:** If the exact same query was made < 5 seconds ago, returns local data immediately.
     * 2.  **Cache Miss:** Fetches from the router, stores the result, and returns it.
     *
     * **Feature: Garbage Collection**
     * Includes a probabilistic strategy (5% chance) to prune expired cache entries
     * on every call to keep memory footprint low.
     *
     * @param extraParams Optional explicit parameters (e.g., `{ 'count-only': 'true' }`).
     * @returns A `MikrotikCollection` (v1.2.0) equipped with pagination and transformation tools.
     *
     * @example
     * // EXAMPLE 1: Standard Fetch (Basic Array)
     * // Get all active PPPoE users as a simple array
     * const users = await client.command('/ppp/active').print().then(c => c.toArray());
     *
     * @example
     * // EXAMPLE 2: Pagination (Frontend Tables)
     * // Get Page 2 of secrets, 25 items per page
     * const page2 = await client.command('/ppp/secret')
     * .where('disabled', 'false')
     * .print()
     * .then(c => c.toPages(2, 25));
     *
     * @example
     * // EXAMPLE 3: High-Performance Lookup (O(1) Map)
     * // Index users by name for instant access without looping
     * const userMap = await client.command('/ppp/secret')
     * .print()
     * .then(c => c.toMap('name'));
     *
     * console.log(userMap['juan_perez']?.password); // Instant access!
     *
     * @example
     * // EXAMPLE 4: Reporting (Grouping)
     * // Group active connections by Service Type (pppoe vs ovpn)
     * const report = await client.command('/ppp/active')
     * .print()
     * .then(c => c.toGrouped('service'));
     *
     * console.log(`PPPoE Users: ${report['pppoe']?.length || 0}`);
     */
    public async print(extraParams?: Record<string, any>): Promise<MikrotikCollection<T>> {
        const fluentParams = this.getParams();
        const finalParams = { ...fluentParams, ...extraParams };

        // GENERATE CACHE KEY
        // Unique key based on: Router Host + Menu Path + Query Parameters
        const host = (this.client as any).options?.host || 'default';
        const cacheKey = `${host}:${this.menuPath}:${JSON.stringify(finalParams)}`;

        // CHECK CACHE
        const cached = CommandBuilder.queryCache.get(cacheKey);
        if (cached && Date.now() < cached.expires) {
            return new MikrotikCollection<T>(cached.data);
        }

        // NETWORK REQUEST (Cache Miss)
        const rawData = await this.client.write(`${this.menuPath}/print`, finalParams);

        // SAVE TO CACHE
        CommandBuilder.queryCache.set(cacheKey, {
            data: rawData,
            expires: Date.now() + CommandBuilder.CACHE_TTL_MS
        });

        // Garbage Collection: Clean up old keys randomly (simple strategy)
        if (Math.random() > 0.95) this.pruneCache();

        return new MikrotikCollection<T>(rawData);
    }

    /**
     * Helper to clean expired cache entries to prevent memory leaks.
     */
    private pruneCache() {
        const now = Date.now();
        for (const [key, val] of CommandBuilder.queryCache.entries()) {
            if (now > val.expires) CommandBuilder.queryCache.delete(key);
        }
    }

    /**
     * **Execution Terminator: First Result**
     *
     * Syntactic sugar for fetching a list and retrieving only the first item.
     * Useful when you know the query will return a single result or you only care about the top record.
     *
     * @returns The first item of type `T`, or `null` if the collection is empty.
     * @example
     * // Get the first active admin user
     * const admin = await client.command('/user').where('group', 'full').first();
     */
    public async first(): Promise<T | null> {
        const collection = await this.print();
        return collection.first();
    }

    // ========================================================
    // WRITE TERMINATORS (Add/Set/Remove)
    // ========================================================

    /**
     * **Execution Terminator: Create Resource (ADD)**
     *
     * Sends an `/add` command to the router to create a new item.
     *
     * **Feature: Automatic Cache Invalidation**
     * Upon success, this method automatically invalidates the local cache for this menu path.
     * This guarantees that the next `.print()` call will fetch fresh data from the router,
     * including the item you just created.
     *
     * **Feature: Offline Queueing**
     * If the router is unreachable and `.persistent()` was used (or global offline mode is on),
     * the command is saved to the `OfflineQueue` for later execution.
     *
     * @param data The object containing the properties for the new item.
     * @returns The MikroTik internal ID (e.g., `*1A`) of the created item, or `'QUEUED_OFFLINE'`.
     *
     * @example
     * // Add a new firewall address list entry
     * const id = await client.command('/ip/firewall/address-list').add({
     * list: 'allowed_users',
     * address: '192.168.88.50',
     * comment: 'Added via API'
     * });
     */
    public async add(data: Partial<T>): Promise<string> {
        const params = this.prepareParams(data);

        // 1. OFFLINE CHECK
        if (this.shouldDefer()) {
            OfflineQueue.enqueue({ action: 'add', path: this.menuPath, params: params });
            return 'QUEUED_OFFLINE';
        }

        // 2. REAL EXECUTION
        const response = await this.client.write(`${this.menuPath}/add`, params);

        // Invalidate Cache for this path to ensure next read is fresh
        this.invalidatePathCache();

        // Safe check for 'ret' property
        if (Array.isArray(response) && response.length > 0 && response[0]['ret']) {
            return response[0]['ret'];
        }
        return '';
    }


    /**
     * **Execution Terminator: Update Resource (SET)**
     *
     * Sends a `/set` command to modify an existing item.
     *
     * **Feature: Idempotency & Cache**
     * Like `.add()`, this triggers cache invalidation. It also handles the tricky
     * `.id` parameter requirement of MikroTik automatically.
     *
     * @param id The internal ID of the item (e.g., `*14`) or a unique name if supported by the menu.
     * @param data An object containing ONLY the fields you want to change (Partial update).
     *
     * @example
     * // Update a PPPoE secret's password
     * await client.command('/ppp/secret').set('*1F', {
     * password: 'new_secure_password',
     * comment: 'Password changed on ' + new Date().toISOString()
     * });
     */
    public async set(id: string, data: Partial<T>): Promise<void> {
        const params = this.prepareParams(data);
        params['.id'] = id;

        if (this.shouldDefer()) {
            OfflineQueue.enqueue({ action: 'set', path: this.menuPath, params: params });
            return;
        }

        await this.client.write(`${this.menuPath}/set`, params);
        this.invalidatePathCache();
    }


    /**
     * **Execution Terminator: Delete Resource (REMOVE)**
     *
     * Sends a `/remove` command to delete one or more items.
     *
     * **Feature: Batch Deletion**
     * You can pass an array of IDs to delete multiple items in a single API call,
     * which is significantly faster than a loop of delete calls.
     *
     * @param id A single ID string (e.g., `*1A`) or an array of IDs.
     *
     * @example
     * // Remove a single item
     * await client.command('/queue/simple').remove('*A1');
     *
     * @example
     * // Batch remove (Kick multiple active connections)
     * const idsToKick = ['*8001', '*8002', '*8003'];
     * await client.command('/ppp/active').remove(idsToKick);
     */
    public async remove(id: string | string[]): Promise<void> {
        const ids = Array.isArray(id) ? id.join(',') : id;
        const params = { '.id': ids };

        if (this.shouldDefer()) {
            OfflineQueue.enqueue({ action: 'remove', path: this.menuPath, params: params });
            return;
        }

        await this.client.write(`${this.menuPath}/remove`, params);
        this.invalidatePathCache();
    }

    // ========================================================
    // STREAMING TERMINATORS (UPDATED)
    // ========================================================

    /**
     * **Streaming Terminator: Data Watcher**
     *
     * Initiates a standard real-time stream using the RouterOS `=follow=` protocol.
     * Used for monitoring **changes in configuration or state** (e.g., "Tell me when a new log appears"
     * or "Notify me when a user connects").
     *
     * **Protocol Internals:**
     * This method automatically constructs the complex packet structure required by RouterOS:
     * - Filters are sent as Queries (`?name=...`).
     * - Properties are sent as Attributes (`=.proplist=...`).
     * - The Streaming Flag (`=follow=`) is appended at the end.
     *
     * @param callback Function to execute whenever a new data packet arrives.
     * @returns A `Subscription` object with a `.stop()` method to cancel the stream.
     *
     * @example
     * // Monitor the System Log in real-time
     * const logStream = client.command('/log')
     * .where('topics', 'error') // Only listen for errors
     * .listen((entry) => {
     * console.log(`NEW ERROR: ${entry.message}`);
     * });
     *
     * // Stop after 1 minute
     * setTimeout(() => logStream.stop(), 60000);
     */
    public listen(callback: (item: T) => void): Subscription {
        // Build Base Command
        const lines = [`${this.menuPath}/print`];

        // Get All Parameters (Filters + Selects)
        const params = this.getParams();

        // Smart Parsing: Distinguish between Queries (?) and Attributes (=)
        for (const [key, value] of Object.entries(params)) {
            let cleanKey = key;

            // Remove existing '?' prefix if present (from .where())
            if (cleanKey.startsWith('?')) {
                cleanKey = cleanKey.substring(1);
            }

            if (cleanKey === '.proplist') {
                // Attributes MUST start with '='
                lines.push(`=${cleanKey}=${value}`);
            } else {
                // Filters MUST start with '?'
                lines.push(`?${cleanKey}=${value}`);
            }
        }

        // Streaming Argument
        lines.push('=follow=');

        // Send Raw Array to Client (Polymorphic Stream)
        return this.client.stream(lines, undefined, callback);
    }

    /**
     * **Streaming Terminator: Traffic & Torch**
     *
     * A specialized listener designed for commands that stream data but **do not** support
     * the standard `/print` syntax, specifically `/interface/monitor-traffic` and `/tool/torch`.
     *
     * **Difference from .listen():**
     * Standard listeners use Query parameters (`?key=value`). Monitor commands require
     * Action parameters (`=key=value`). This method automatically converts your `.where()`
     * filters into the correct format for these tools.
     *
     * @param callback Function to execute with the live metric data.
     * @returns A `Subscription` object.
     *
     * @example
     * // Monitor Bandwidth on Ether1
     * client.command('/interface') // or '/interface/monitor-traffic'
     * .where('interface', 'ether1')
     * .listenMonitor((stats) => {
     * console.log(`RX: ${stats['rx-bits-per-second']} bps`);
     * });
     */
    public listenMonitor(callback: (item: T) => void): Subscription {
        const rawParams = this.getParams();
        const actionParams: Record<string, string> = {};

        // Convert standard query params to action params (remove '?')
        for (const [key, value] of Object.entries(rawParams)) {
            const cleanKey = key.startsWith('?') ? key.substring(1) : key;
            actionParams[cleanKey] = value;
        }

        let cmd = this.menuPath;
        if (!cmd.endsWith('monitor-traffic') && !cmd.endsWith('torch')) {
            cmd = `${cmd}/monitor-traffic`;
        }

        return this.client.stream(cmd, actionParams, callback);
    }

    // ========================================================
    // INTERNAL HELPERS
    // ========================================================

    /**
     * Clears cache entries related to the current menu path.
     */
    private invalidatePathCache() {
        const host = (this.client as any).options?.host || 'default';
        const prefix = `${host}:${this.menuPath}`;

        for (const key of CommandBuilder.queryCache.keys()) {
            if (key.startsWith(prefix)) {
                CommandBuilder.queryCache.delete(key);
            }
        }
    }

    private shouldDefer(): boolean {
        if (!this.isPersistentRequest) return false;
        return !this.isClientConnected();
    }

    private isClientConnected(): boolean {
        // Accessing private socket property via 'any' casting (safe within library context)
        const socket = (this.client as any)['socket'];
        return socket && socket['connected'] === true;
    }

    /**
     * Merges query params (filters) and property list (selects).
     */
    private getParams(): Record<string, string> {
        const params: Record<string, string> = { ...this.queryParams };

        // Add .proplist if select() was used
        if (this.propList.length > 0) {
            // Note: We add it as a plain key here, listen() handles the '=' prefix
            params['.proplist'] = this.propList.join(',');
        }
        return params;
    }

    private formatValue(value: string | number | boolean): string {
        if (typeof value === 'boolean') {
            return value ? 'yes' : 'no';
        }
        return String(value);
    }

    private prepareParams(data: any): Record<string, any> {
        const params: Record<string, any> = {};
        for (const [key, value] of Object.entries(data)) {
            const kebabKey = camelToKebab(key);
            params[kebabKey] = this.formatValue(value as any);
        }
        return params;
    }
}