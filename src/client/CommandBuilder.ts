import {MikrotikClient, Subscription} from './MikrotikClient';
import {camelToKebab} from '../utils/Helpers';
import {MikrotikCollection} from '../utils/MikrotikCollection';
import {OfflineQueue} from '../core/OfflineQueue';

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
 * * Supports Real-Time Streaming, Persistent Queueing, Smart Caching,
 * * and Enterprise REST Features (Idempotency, Projections).
 */
export class CommandBuilder<T extends Record<string, any>> {
    private readonly client: MikrotikClient;
    private readonly menuPath: string;

    private _idempotencyKey?: string;

    // Internal storage for query parts
    private queryParams: Record<string, string> = {};
    private propList: string[] = [];

    // Internal state for execution options
    private _idempotent: boolean = false;

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
        this.queryParams[`?${kebabKey}`] = this.formatValue(value);

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
        // In MikroTik API, existence is queried by sending the key without value (Socket)
        // or properly mapped in REST via your translateToRest logic.
        this.queryParams[`?${kebabKey}`] = '';
        return this;
    }


    /**
     * **Field Projection (.select)**
     *
     * Restricts the fields returned by the router to a specific list.
     * Using this method significantly reduces CPU load on the router and network bandwidth,
     * especially when querying large tables like the routing table or logs.
     * Corresponds to the MikroTik API argument `.proplist`.
     *
     * **Feature: Auto-Kebab Case**
     * Inputs like `rxByte` are automatically converted to `rx-byte`.
     *
     * **Usage Levels:**
     * * 1. **Novice:** Simple array of strings. `['name', 'address']`
     * * 2. **Advanced (Surgical):** Type-safe list of keys ensuring they exist in interface T.
     *
     * @param fields An array of field names to retrieve (can be type-safe keys).
     * @returns The current builder instance for chaining.
     *
     * @example
     * // Get only the name and uptime of active users (ignoring traffic stats)
     * const users = await client.command<PPPActive>('/ppp/active')
     * .select(['name', 'uptime']) // optimized request
     * .print();
     */
    public select(fields: (keyof T | string)[]): this {
        const fieldStrings = fields.map(String);

        // Convert camelCase (JS) to kebab-case (MikroTik)
        // e.g., 'callerId' -> 'caller-id'
        const kebabFields = fieldStrings.map(f => camelToKebab(f));

        // Use a Set to avoid duplicate fields in the request
        const uniqueFields = new Set([...this.propList, ...kebabFields]);
        this.propList = Array.from(uniqueFields);

        return this;
    }

    /**
     * **Enable Idempotency (.idempotent)**
     *
     * Flags the next operation to be **"Safe from Duplicates"**.
     *
     * * **Effect:** If you call `.add()` and the item already exists (based on a unique key like 'name'),
     * the library will NOT throw an error. Instead, it will gracefully fetch and return the existing item.
     * * **Requirement:** This is primarily supported in REST mode (v7+). In Socket mode, behavior depends on driver support.
     *
     * @returns The current builder instance for chaining.
     * @example
     * // Safe Create: Won't fail if 'vlan10' exists
     * client.command('/interface/vlan')
     * .idempotent()
     * .add({ name: 'vlan10', 'vlan-id': 10 });
     */
    public idempotent(keyField?: string): this {
        this._idempotent = true;
        this._idempotencyKey = keyField;
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
        // Iterate over criteria and use the main .where() method.
        // This ensures formatValue() and camelToKebab() are applied consistently.
        for (const [key, value] of Object.entries(criteria)) {
            // Force casting to handle string|number|boolean properly
            this.where(key, value as string | number | boolean);
        }

        // Execute the print command (which handles the REST/Socket translation)
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
        // We reuse the central 'findBy' logic to ensure consistent query parsing
        const collection = await this.findBy(criteria);
        return collection.count() > 0 ? collection.first() : null;
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
        const finalParams = {...fluentParams, ...extraParams};

        // GENERATE CACHE KEY
        const host = (this.client as any).options?.host || 'default';
        const cacheKey = `${host}:${this.menuPath}:${JSON.stringify(finalParams)}`;

        // CHECK CACHE
        const cached = CommandBuilder.queryCache.get(cacheKey);
        if (cached && Date.now() < cached.expires) {
            return new MikrotikCollection<T>(cached.data);
        }

        // NETWORK REQUEST (Cache Miss)
        const rawData = await this.client.write(`${this.menuPath}/print`, finalParams);

        let cleanData: T[] = [];

        if (Array.isArray(rawData)) {
            cleanData = rawData;
        } else if (rawData && typeof rawData === 'object') {
            cleanData = [rawData as T];
        }

        // SAVE TO CACHE
        CommandBuilder.queryCache.set(cacheKey, {
            data: cleanData,
            expires: Date.now() + CommandBuilder.CACHE_TTL_MS
        });

        if (Math.random() > 0.95) this.pruneCache();

        return new MikrotikCollection<T>(cleanData);
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
        // We execute print(). Note: MikroTik API does not natively support 'LIMIT 1'
        // effectively without scripting, so this fetches the filtered list.
        const collection = await this.print();

        // Ensure we return null if the collection is empty, not undefined.
        return collection.count() > 0 ? collection.first() : null;
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
     * **Feature: Idempotency**
     * If `.idempotent()` was called, passes the flag to the client to safely handle duplicates.
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
    public async add(data: Partial<T>): Promise<string | T> {
        const params = this.prepareParams(data);

        // OFFLINE CHECK
        if (this.shouldDefer()) {
            OfflineQueue.enqueue({ action: 'add', path: this.menuPath, params: params });
            return 'QUEUED_OFFLINE';
        }

        // REAL EXECUTION
        const response = await this.client.write(
            `${this.menuPath}/add`,
            params, {
                idempotent: this._idempotent,
                idempotencyKey: this._idempotencyKey
            }
        );

        this.invalidatePathCache();

        let responseObj: any = null;

        if (Array.isArray(response) && response.length > 0) {
            responseObj = response[0]; // (Socket)
        } else if (typeof response === 'object' && response !== null) {
            responseObj = response;    // (REST)
        }

        // Idempotency Recovery
        if (this._idempotent && responseObj && responseObj['_idempotent_recovery']) {
            return responseObj as T;
        }


        let newId = responseObj ? (responseObj['ret'] || responseObj['.id']) : null;

        if (!newId && params['name']) {
            try {
                const search = await this.client.write(`${this.menuPath}/print`, {
                    '?name': params['name']
                });
                if (Array.isArray(search) && search.length > 0) {
                    return search[0] as T;
                }
            } catch (e) {
                console.warn("Fallback search failed", e);
            }
        }

        if (newId) {
            try {
                const fetchResponse = await this.client.write(
                    `${this.menuPath}/print`,
                    { '.id': newId }
                );

                if (Array.isArray(fetchResponse) && fetchResponse.length > 0) {
                    return fetchResponse[0] as T;
                }
                // (REST direct ID fetch)
                else if (typeof fetchResponse === 'object' && fetchResponse !== null && !Array.isArray(fetchResponse)) {
                    return fetchResponse as T;
                }

            } catch (error) {
                console.warn(`Auto-fetch failed for ${newId}`, error);
            }

            return newId;
        }

        return '';
    }

    /**
     * **Get or Create (Syntactic Sugar)**
     * * A shorthand method that enables idempotency and executes the add.
     * * Semantically clearer for business logic "Ensure this exists".
     * * @param data The data to ensure exists.
     * @returns The Single item created or recovered.
     */
    public async getOrCreate(data: Partial<T>): Promise<T> {
        this.idempotent(); // Enable flag
        const result = await this.add(data);

        // If result is string (Socket ID), we might need to fetch it (not implemented here for speed)
        // If result is object (REST recovery), return it.
        if (typeof result === 'object') return result as T;

        // Fallback for ID return
        return {'.id': result} as unknown as T;
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
    public async set(id: string, data: Partial<T>): Promise<T> {
        const params = this.prepareParams(data);
        params['.id'] = id;

        // OFFLINE CHECK
        if (this.shouldDefer()) {
            OfflineQueue.enqueue({action: 'set', path: this.menuPath, params: params});
            throw new Error("OFFLINE_QUEUED");
        }

        await this.client.write(`${this.menuPath}/set`, params);
        this.invalidatePathCache();

        // AUTO-FETCH
        try {
            const fetchResponse = await this.client.write(
                `${this.menuPath}/print`,
                { '.id': id }
            );

            if (Array.isArray(fetchResponse) && fetchResponse.length > 0) {
                return fetchResponse[0] as unknown as T;
            }

            else if (typeof fetchResponse === 'object' && fetchResponse !== null) {
                if (!Array.isArray(fetchResponse)) {
                    return fetchResponse as unknown as T;
                }
            }

        } catch (error) {
            console.warn(`Set successful, but auto-fetch failed for ${id}`, error);
        }

        return { '.id': id, ...data } as unknown as T;
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
    public async remove(id: string | string[]): Promise<string[]> {
        // Always normalize input to an Array
        const ids = Array.isArray(id) ? id : [id];

        // OFFLINE CHECK
        if (this.shouldDefer()) {
            // For offline queue, store the "joined" version (comma-separated) for compactness
            OfflineQueue.enqueue({
                action: 'remove',
                path: this.menuPath,
                params: { '.id': ids.join(',') }
            });
            // Return empty array indicating online deletion was not confirmed
            return [];
        }

        try {
            // Execute parallel requests.
            // This ensures compatibility with REST API, which typically requires individual
            // DELETE requests per ID rather than a comma-separated list in the URL path.
            await Promise.all(ids.map(singleId => {
                return this.client.write(`${this.menuPath}/remove`, { '.id': singleId });
            }));
        } catch (error) {
            console.error("Error during bulk removal:", error);
            throw error;
        }

        // Invalidate Cache for this path to ensure next read is fresh
        this.invalidatePathCache();

        return ids;
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
        // If socket is null (pure REST mode), assume connected via HTTP or let fetch fail naturally
        if (!socket) return true;
        return socket['connected'] === true;
    }

    /**
     * Merges query params (filters) and property list (selects).
     */
    private getParams(): Record<string, string> {
        const params: Record<string, string> = {...this.queryParams};

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