import { MikrotikClient, Subscription } from "../client/MikrotikClient";
import { SnapshotSubscription, SnapshotDiff } from "../client/SnapshotSubscription";

/**
 * Flexible callback definition.
 * Can receive a standard Array OR a Diff object depending on configuration.
 */
export type SnapshotCallback<T> = (data: T[] | SnapshotDiff<T>) => void;

/**
 * LiveCollection
 * ==========================================
 * Manages a real-time synchronized collection of items from the router.
 *
 * Instead of firing simple callbacks, it manages 'SnapshotSubscription' instances.
 * This allows each subscriber to have their own Throttle settings and Diff modes.
 *
 * @template T The type of the items in the collection.
 */
export class LiveCollection<T extends Record<string, any>> {
    /** Internal storage mapped by item ID (e.g., "*1A") */
    private localCache = new Map<string, T>();

    /** The active low-level subscription object returned by the Client/Socket */
    private subscription: Subscription | null = null;

    /**
     * CHANGED: List of active "Smart Subscriptions" instead of simple functions.
     * This allows us to call .processUpdate() on each one.
     */
    private subscriptions: SnapshotSubscription<T>[] = [];

    /** Flag to prevent double initialization */
    private isInitializing = false;

    /**
     * Creates an instance of LiveCollection.
     * @param client The main MikrotikClient instance.
     * @param path The menu path to listen to (e.g., '/ppp/active').
     * @param query Optional filter object (e.g. { name: 'admin' }).
     */
    constructor(
        private client: MikrotikClient,
        private path: string,
        private query: Record<string, string | number | boolean> = {}
    ) {}

    /**
     * Subscribes to real-time updates.
     *
     * v1.2.0 Change:
     * Returns a `SnapshotSubscription` object instead of a cleanup function.
     * This enables chaining methods like `.onDiff()`, `.throttle()`, and `.join()`.
     *
     * @param callback Function to execute when data changes.
     * @returns The Subscription object for chaining configuration.
     */
    public onSnapshot(callback: SnapshotCallback<T>): SnapshotSubscription<T> {
        // Define the cleanup logic for this specific subscriber
        const unsubscribeLogic = () => {
            this.subscriptions = this.subscriptions.filter(s => s !== sub);

            // If no one is listening anymore, stop the router connection to save bandwidth
            if (this.subscriptions.length === 0) {
                this.stopListening();
            }
        };

        // Create the Smart Subscription
        const sub = new SnapshotSubscription<T>(
            this.client,
            callback,
            unsubscribeLogic
        );

        this.subscriptions.push(sub);

        // Send immediate data if we already have cache (Hot Observable behavior)
        if (this.localCache.size > 0) {
            // We use processUpdate so logic like Join or Diff runs even on the first data
            sub.processUpdate(Array.from(this.localCache.values()));
        }

        // Start Router connection if this is the first listener
        if (!this.subscription && !this.isInitializing) {
            this.startListening().catch(err => {
                console.error("RosInterface: Error starting live listener", err);
            });
        }

        return sub;
    }

    /**
     * Internal method to establish the connection via the client.
     */
    private async startListening() {
        if (this.isInitializing) return;
        this.isInitializing = true;

        try {
            // Initialize Command
            const cmd = this.client.command(this.path);

            // Optimization: Request specific fields to reduce CPU load on Router.
            // CRITICAL: We MUST include '.dead' to detect deletions.
            cmd.where('.proplist', '.id,.dead,name,comment,disabled,profile,service,user,password,address,uptime,mac-address,caller-id,bytes-in,bytes-out,radius');

            // Apply Filters from Query
            if (this.query) {
                Object.keys(this.query).forEach(key => {
                    const value = this.query[key];
                    if (['string', 'number', 'boolean'].includes(typeof value)) {
                        cmd.where(key, value);
                    }
                });
            }

            // Start Streaming
            this.subscription = cmd.listen((packet: any) => {
                this.processPacket(packet);
            });

        } catch (error) {
            console.error(`RosInterface: Failed to listen on ${this.path}`, error);
            this.isInitializing = false;
        }
    }

    /**
     * Processes incoming raw packets from RouterOS.
     * Handles creation, updates, and deletion based on packet flags.
     * @param packet Raw data from the router.
     */
    private processPacket(packet: any) {
        // RouterOS raw packets use '.id', but sometimes it might be parsed as 'id'
        const rawId = packet['.id'] || packet['id'];

        // Ignore status packets (!done, !fatal)
        if (!rawId) return;

        // HANDLE DELETION
        if (packet['.dead'] === true || packet['dead'] === true) {
            this.localCache.delete(rawId);
        }
        // HANDLE UPDATE / INSERT
        else {
            const existing = this.localCache.get(rawId) || {};

            // Normalize keys: Remove leading dots
            const cleanPacket: any = {};
            for (const key of Object.keys(packet)) {
                const cleanKey = key.startsWith('.') ? key.substring(1) : key;
                cleanPacket[cleanKey] = packet[key];
            }

            // Merge with existing data to support partial updates
            const updated = { ...existing, ...cleanPacket };
            this.localCache.set(rawId, updated as T);
        }

        // BROADCAST TO SMART SUBSCRIPTIONS
        // Instead of sending the array directly, we let the Subscription object
        // decide IF and WHEN to send it (Throttle) and HOW (Diff/Join).
        this.emit();
    }

    /**
     * Broadcasts the current array of items to all smart subscriptions.
     */
    private emit() {
        const fullList = Array.from(this.localCache.values());

        // We delegate the logic to each subscription.
        // One user might want Diffs, another might want the full list throttled.
        this.subscriptions.forEach(sub => {
            sub.processUpdate(fullList);
        });
    }

    /**
     * Stops the low-level connection to the router.
     */
    private stopListening() {
        if (this.subscription) {
            try {
                this.subscription.stop();
            } catch (e) {
                console.warn('RosInterface: Error stopping subscription', e);
            }
            this.subscription = null;
        }
        this.localCache.clear();
        this.isInitializing = false;
    }
}