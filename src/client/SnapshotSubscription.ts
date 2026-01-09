import { MikrotikClient } from './MikrotikClient';

/**
 * Defines the structure of a Differential Update event.
 * Returned when .onDiff() mode is active.
 */
export interface SnapshotDiff<T> {
    /** Items that did not exist in the previous snapshot */
    added: T[];
    /** Items that exist but have changed (e.g. uptime increased, status changed) */
    modified: T[];
    /** Items that were present before but are gone now */
    removed: T[];
    /** The full current list (for reference/fallback) */
    current: T[];
}

/**
 * **Smart Subscription Controller**
 *
 * Controls the flow of data from the Router to your Application.
 * It acts as a middleware pipeline that adds intelligence to raw data streams:
 * 1.  **Throttling:** Protects your app from CPU spikes using "Leading + Trailing Edge" logic.
 * 2.  **Diffing:** Calculates atomic changes (Added/Removed) instead of dumping full arrays.
 * 3.  **Hydration (Join):** Merges data from other MikroTik tables in real-time.
 */
export class SnapshotSubscription<T extends Record<string, any>> {
    // ==========================================
    // CONFIGURATION STATE
    // ==========================================
    private isDiffMode = false;
    private throttleMs = 0;
    private joinConfig: { from: string; localField: string; foreignField: string; as: string } | null = null;

    // ==========================================
    // EXECUTION STATE
    // ==========================================
    private lastExecutionTime = 0;

    /**
     * Stores the LAST processed dataset to compare against the new one.
     * Crucial for the Diff algorithm to work correctly.
     */
    private previousSnapshot: T[] = [];

    // ==========================================
    // THROTTLING BUFFER
    // ==========================================
    private throttleTimer: NodeJS.Timeout | null = null;
    private pendingUpdate: T[] | null = null;

    // ==========================================
    // DEPENDENCIES
    // ==========================================
    private readonly callback: (data: T[] | SnapshotDiff<T>) => void;
    private readonly client: MikrotikClient;
    private readonly unsubscribeFn: () => void;

    constructor(
        client: MikrotikClient,
        callback: (data: any) => void,
        unsubscribeFn: () => void
    ) {
        this.client = client;
        this.callback = callback;
        this.unsubscribeFn = unsubscribeFn;
    }

    // ==========================================
    // CHAINABLE MODIFIERS (API)
    // ==========================================

    /**
     * **Modifier: Enable Differential Updates (Delta Mode)**
     *
     * Switches the subscription from "Standard Mode" (emitting the full array every time)
     * to "Differential Mode".
     *
     * **Behavior Change:**
     * Instead of receiving `T[]`, your callback will receive a `SnapshotDiff<T>` object.
     *
     * **Why use this?**
     * - **Bandwidth:** You don't need to re-process 2,000 users if only 1 disconnected.
     * - **Frontend Performance:** Allows atomic DOM updates (append/remove) instead of full re-renders.
     *
     * @returns The current subscription instance for chaining.
     *
     * @example
     * // SCENARIO: Security Watchdog
     * // We only want alerts when a NEW IP is added to the Blacklist.
     * client.collection('/ip/firewall/address-list')
     * .where('list', 'banned')
     * .onSnapshot((diff) => {
     * // TypeScript Check: Is this a Diff object?
     * if ('added' in diff) {
     * diff.added.forEach(ip => sendTelegramAlert(`New Banned IP: ${ip.address}`));
     * diff.removed.forEach(ip => console.log(`IP Unbanned: ${ip.address}`));
     * }
     * })
     * .onDiff(); // <--- Activates the mode
     */
    public onDiff(): this {
        this.isDiffMode = true;
        return this;
    }

    /**
     * **Modifier: Intelligent Rate Limiting (Throttle)**
     *
     * Controls the flow of updates to prevent overwhelming the application CPU or the Network.
     *
     * **Strategy: Leading + Trailing Edge**
     * 1. **Leading Edge:** The FIRST update passes immediately (Instant Feedback).
     * 2. **Throttling Phase:** Subsequent updates are blocked for `ms` milliseconds.
     * 3. **Trailing Edge:** If data changed during the block period, the *latest* state
     * is emitted immediately after the timer expires (Eventual Consistency).
     *
     * **Use Case:**
     * "Storm Control". When a tower reboots, 500 PPPoE users might reconnect in 1 second.
     * Without throttling, your UI would freeze trying to render 500 times.
     *
     * @param ms The minimum time (in milliseconds) between two callback executions.
     * @returns The current subscription instance for chaining.
     *
     * @example
     * // SCENARIO: High-Traffic Dashboard
     * // Update the traffic graph max once every 2 seconds.
     * client.collection('/interface/monitor-traffic')
     * .onSnapshot(updateGraph)
     * .throttle(2000);
     */
    public throttle(ms: number): this {
        this.throttleMs = ms;
        return this;
    }

    /**
     * **Modifier: Real-Time Data Join (Hydration)**
     *
     * Performs a client-side "Left Join" between the live stream and another static collection.
     * Useful for enriching IDs with human-readable names or details from another menu.
     *
     * **How it works:**
     * For every update in the live stream, the library fetches data from the `from` path,
     * matches it using `localField` === `foreignField`, and attaches the result to `as`.
     *
     * @param config Configuration object for the join.
     * @returns The current subscription instance.
     *
     * @example
     * // SCENARIO: Enriched User Table
     * // Show Active Users (Live) + Their Plan Details (Static from Secrets)
     * client.collection('/ppp/active')
     * .onSnapshot((users) => {
     * users.forEach(user => {
     * // 'secretDetails' is injected by the join
     * const plan = user.secretDetails?.profile || 'Unknown';
     * console.log(`User: ${user.name} is on plan: ${plan}`);
     * });
     * })
     * .join({
     * from: '/ppp/secret',      // Foreign Table
     * localField: 'name',       // Key in /ppp/active
     * foreignField: 'name',     // Key in /ppp/secret
     * as: 'secretDetails'       // Result property name
     * })
     * .throttle(1000); // Important: Throttle joins to save bandwidth!
     */
    public join(config: { from: string; localField: string; foreignField: string; as: string }): this {
        this.joinConfig = config;
        return this;
    }

    /**
     * **Lifecycle: Unsubscribe**
     *
     * Permanently stops this specific subscription.
     *
     * **Cleanup Logic:**
     * 1. Clears any pending throttled updates (timers).
     * 2. Removes this listener from the parent `LiveCollection`.
     * 3. **Smart Disconnect:** If this was the *last* listener for this path,
     * the underlying physical socket connection to the router is closed.
     *
     * @example
     * // React/Vue Component Cleanup
     * useEffect(() => {
     * const sub = client.collection('/log').onSnapshot(updateLogs);
     * return () => sub.stop(); // Called when component unmounts
     * }, []);
     */
    public stop(): void {
        this.clearPending();
        this.unsubscribeFn();
    }

    // ==========================================
    // INTERNAL ORCHESTRATION
    // ==========================================

    /**
     * **Internal Execution Orchestrator**
     * Called automatically by LiveCollection when raw data arrives.
     * Decides WHEN to execute based on throttling logic.
     * @internal
     */
    public async processUpdate(newData: T[]): Promise<void> {
        const now = Date.now();
        const timeSinceLast = now - this.lastExecutionTime;

        // SCENARIO 1: No throttling (Pass-through)
        if (this.throttleMs === 0) {
            await this.executeCallbackLogic(newData);
            this.lastExecutionTime = Date.now();
            return;
        }

        // SCENARIO 2: Leading Edge (Execute Immediately)
        // If enough time has passed since the last run, run now.
        if (timeSinceLast >= this.throttleMs) {
            this.clearPending();
            await this.executeCallbackLogic(newData);
            this.lastExecutionTime = Date.now();
        }
            // SCENARIO 3: Throttling (Buffer)
        // Save data and wait for timer.
        else {
            this.pendingUpdate = newData;

            if (!this.throttleTimer) {
                const waitTime = this.throttleMs - timeSinceLast;
                this.throttleTimer = setTimeout(() => {
                    this.flushPending();
                }, waitTime);
            }
        }
    }

    private async flushPending() {
        this.throttleTimer = null;
        if (this.pendingUpdate) {
            await this.executeCallbackLogic(this.pendingUpdate);
            this.lastExecutionTime = Date.now();
            this.pendingUpdate = null;
        }
    }

    private clearPending() {
        if (this.throttleTimer) {
            clearTimeout(this.throttleTimer);
            this.throttleTimer = null;
        }
        this.pendingUpdate = null;
    }

    // ==========================================
    // CORE LOGIC (Diffing & Joining)
    // ==========================================

    /**
     * Applies Joins, Calculates Diffs, Updates State, and Fires Callback.
     * This is where the magic happens.
     */
    private async executeCallbackLogic(currentData: T[]): Promise<void> {
        let processedData = currentData;

        // JOIN LOGIC (Data Hydration)
        if (this.joinConfig) {
            try {
                // Fetch foreign data (CommandBuilder handles caching implicitly)
                const foreignData = await this.client.write(`${this.joinConfig.from}/print`);

                // Create lookup map for O(1) matching efficiency
                const foreignMap = new Map<string, any>();
                foreignData.forEach((item: any) => {
                    const key = String(item[this.joinConfig!.foreignField]);
                    foreignMap.set(key, item);
                });

                // Merge Data
                processedData = currentData.map(localItem => {
                    const key = String(localItem[this.joinConfig!.localField]);
                    return {
                        ...localItem,
                        [this.joinConfig!.as]: foreignMap.get(key) || null
                    };
                });
            } catch (error) {
                console.warn(`RosInterface: Join failed for ${this.joinConfig.from}. Returning un-joined data.`, error);
                // On error, we proceed with un-joined data so the stream doesn't crash.
            }
        }

        // DIFF LOGIC
        if (this.isDiffMode) {
            // Compare LAST known state vs NEW state
            const diff = this.calculateDiff(this.previousSnapshot, processedData);

            // CRITICAL: Update state for the next run
            this.previousSnapshot = processedData;

            // Optimization: Only fire callback if there are actual changes
            if (diff.added.length > 0 || diff.modified.length > 0 || diff.removed.length > 0) {
                this.callback(diff);
            }
        }
        // STANDARD LOGIC
        else {
            // Even in standard mode, we must update the state in case
            // the user switches to .onDiff() later dynamically.
            this.previousSnapshot = processedData;
            this.callback(processedData);
        }
    }

    /**
     * Calculates the difference between two arrays using '.id' as the Strict Key.
     * This prevents false "Modified" events when items are deleted/created.
     */
    private calculateDiff(oldData: T[], newData: T[]): SnapshotDiff<T> {
        const diff: SnapshotDiff<T> = { added: [], modified: [], removed: [], current: newData };

        // Helper to safely get ID
        const getId = (item: any) => {
            if (item['.id']) return item['.id'];
            if (item['name']) return `name:${item['name']}`;
            return JSON.stringify(item);
        };

        const oldMap = new Map();
        oldData.forEach(item => oldMap.set(getId(item), item));

        const newMap = new Map();
        newData.forEach(item => newMap.set(getId(item), item));

        // Detect Added & Modified
        for (const newItem of newData) {
            const id = getId(newItem);

            if (!oldMap.has(id)) {
                diff.added.push(newItem);
            } else {
                const oldItem = oldMap.get(id);
                if (!this.areEqual(oldItem, newItem)) {
                    diff.modified.push(newItem);
                }
            }
        }

        // Detect Removed
        for (const oldItem of oldData) {
            const id = getId(oldItem);
            if (!newMap.has(id)) {
                diff.removed.push(oldItem);
            }
        }

        return diff;
    }

    private areEqual(obj1: any, obj2: any): boolean {
        return JSON.stringify(obj1) === JSON.stringify(obj2);
    }
}