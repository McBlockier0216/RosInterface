import { MikrotikClient } from '../client/MikrotikClient';

/**
 * SchemaMapper
 * * Responsible for the "Auto-Topology Discovery" feature.
 * * It automatically detects the router's capabilities (Version, Architecture, Packages)
 * upon connection and builds a map of "Smart Paths".
 * * This allows the developer to use abstract aliases (like 'wifi') without worrying
 * if the underlying router is running RouterOS v6 (legacy) or v7 (modern).
 */
export class SchemaMapper {
    /** Full RouterOS version string (e.g., "7.12.1" or "6.49.10") */
    public version: string = '';

    /** The major version number (e.g., 7 or 6). Vital for logic branching. */
    public majorVersion: number = 0;

    /** The hardware model name (e.g., "CCR2004-1G-12S+2XS") */
    public boardName: string = '';

    /** The CPU architecture (e.g., "arm64", "mipsbe", "tile") */
    public architecture: string = '';

    /** Flag indicating if the router has wireless capabilities installed */
    public hasWireless: boolean = false;

    /** Internal dictionary to store path translations */
    private pathAliases: Record<string, string> = {};

    /**
     * Scans the connected router to determine its specifications and capabilities.
     * This method should be called immediately after a successful login.
     * * @param client The active MikrotikClient instance.
     */
    public async load(client: MikrotikClient): Promise<void> {
        try {
            // 1. Fetch vital system information
            // We use the raw command to avoid circular dependency logic here
            const resourceCollection = await client.command('/system/resource').print();
            const resource = resourceCollection.first();

            if (resource) {
                this.version = resource.version || '0.0.0';
                // Extract the first number from "7.12.1" -> 7
                this.majorVersion = parseInt(this.version.split('.')[0]);
                this.boardName = resource['board-name'] || 'unknown';
                this.architecture = resource['architecture-name'] || 'unknown';
            }

            // 2. Detect installed packages (to determine if WiFi/IoT/Container features exist)
            // Wrapped in try-catch because read-only users might not have permission to view packages.
            try {
                const packages = await client.command('/system/package').print();
                this.hasWireless = packages.filter(p =>
                    p.name === 'wireless' || p.name === 'wifiwave2' || p.name === 'wifi'
                ).count() > 0;
            } catch (e) {
                console.warn('[SchemaMapper] Warning: Could not scan packages (Permission denied?). Defaulting features to false.');
            }

            // 3. Build the Smart Path Map based on the detected version
            this.buildPathMap();

            console.log(`Schema Loaded: RouterOS v${this.version} (${this.architecture}) on ${this.boardName}`);

        } catch (error) {
            console.error('Schema Discovery Failed:', error);
            // Fallback: Assume v6 if detection fails to prevent crashes
            this.majorVersion = 6;
            this.buildPathMap();
        }
    }

    /**
     * defines the translation rules for aliases based on the RouterOS version.
     */
    private buildPathMap() {
        if (this.majorVersion >= 7) {
            // --- MODERN ROUTEROS v7 MAPPINGS ---

            // WiFi: v7 uses the new 'wifi' package (formerly wifiwave2) or legacy wireless
            // We default to the modern interface, but this could be refined further.
            this.pathAliases['wifi'] = '/interface/wifi';

            // Routing protocols structure changed significantly in v7
            this.pathAliases['bgp'] = '/routing/bgp/connection';
            this.pathAliases['ospf'] = '/routing/ospf/instance';
            this.pathAliases['firewall'] = '/ip/firewall/filter'; // Standard
        } else {
            // --- LEGACY ROUTEROS v6 MAPPINGS ---

            this.pathAliases['wifi'] = '/interface/wireless';
            this.pathAliases['bgp'] = '/routing/bgp/peer';
            this.pathAliases['ospf'] = '/routing/ospf/instance'; // OSPFv2 usually
            this.pathAliases['firewall'] = '/ip/firewall/filter';
        }
    }

    /**
     * Resolves an abstract path alias to the concrete RouterOS path.
     * * @example
     * // On RouterOS v7:
     * schema.resolve('wifi') // Returns "/interface/wifi"
     * * // On RouterOS v6:
     * schema.resolve('wifi') // Returns "/interface/wireless"
     * * // Non-aliases are returned as is:
     * schema.resolve('/ip/address') // Returns "/ip/address"
     * * @param path The path alias or full path to resolve.
     * @returns The actual menu path for the connected router.
     */
    public resolve(path: string): string {
        // Remove leading slash for dictionary lookup consistency
        const cleanPath = path.startsWith('/') ? path.substring(1) : path;

        // Return the mapped alias if it exists, otherwise return the original path
        return this.pathAliases[cleanPath] || path;
    }

    /**
     * Helper to determine if the connected router is running RouterOS v7 or higher.
     * Useful for conditional logic in developer scripts.
     */
    public isV7(): boolean {
        return this.majorVersion >= 7;
    }

    /**
     * Helper to check if the router is running on ARM architecture (Performance tuning).
     */
    public isArm(): boolean {
        return this.architecture === 'arm' || this.architecture === 'arm64';
    }
}