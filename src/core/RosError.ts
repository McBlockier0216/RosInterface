/**
 * core/RosError.ts
 *
 * Sophisticated Error wrapper for RouterOS interactions.
 * Features:
 * - Semantic Getters (isNotFound, isAuthError, etc.)
 * - Static Factory for parsing raw Fetch Responses.
 * - JSON serialization support.
 */
import { RosHttpStatus, RosHttpMessages } from './HttpConstants';

export class RosError extends Error {
    public readonly isRosError = true;
    public readonly timestamp: Date;

    constructor(
        public readonly status: number,
        public readonly detail: string,
        public readonly command: string,
        public readonly rawResponse?: any // Saves the full JSON body for deep debugging
    ) {
        // Construct a highly readable log message
        // Format: "RouterOS [404] Not Found (/ip/address/print) -> Item *99 not found"
        const prefix = RosHttpMessages[status] || 'Unknown Error';
        super(`RouterOS [${status}] ${prefix} (${command}) -> ${detail}`);

        this.name = 'RosError';
        this.timestamp = new Date();

        // Fix for extending built-ins in TypeScript/ES6
        Object.setPrototypeOf(this, RosError.prototype);
    }

    // --- 1. Surgical Precision Getters ---

    /** Resource missing (404) */
    get isNotFound(): boolean {
        return this.status === RosHttpStatus.NOT_FOUND;
    }

    /** Authentication failure (401) */
    get isAuthError(): boolean {
        return this.status === RosHttpStatus.UNAUTHORIZED;
    }

    /** Permissions failure (403) */
    get isPermissionError(): boolean {
        return this.status === RosHttpStatus.FORBIDDEN;
    }

    /** * Critical: Detects if the error is due to a duplicate item.
     * Useful for Idempotency logic.
     */
    get isDuplicate(): boolean {
        if (this.status !== RosHttpStatus.BAD_REQUEST) return false;
        const msg = this.detail.toLowerCase();
        return msg.includes('already exists') || msg.includes('already have');
    }

    /** Rate Limiting hit (429) */
    get isRateLimit(): boolean {
        return this.status === RosHttpStatus.TOO_MANY_REQUESTS;
    }

    /** True if the error is likely temporary (503, 429, etc) */
    get isRetryable(): boolean {
        // We import the logic from HttpConstants to keep it DRY
        // (Assuming you exported the helper function, otherwise implement logic here)
        return [429, 503, 504, 502].includes(this.status);
    }

    // --- 2. Factory Method (The Logic Cleaner) ---

    /**
     * static factory to parse a Fetch Response and throw/return a typed RosError.
     * Encapsulates all the "dirty" JSON parsing logic from RouterOS.
     */
    public static async fromResponse(response: Response, command: string): Promise<RosError> {
        const status = response.status;
        let detail = response.statusText;
        let rawBody: any = null;

        try {
            const text = await response.text();

            // Try parsing JSON
            try {
                rawBody = JSON.parse(text);
                // RouterOS usually puts the error in 'detail' or 'message'
                detail = rawBody.detail || rawBody.message || text;
            } catch {
                // If not JSON, use the raw text (e.g. HTML from a proxy)
                detail = text || detail;
            }
        } catch (e) {
            detail = "Could not read response body";
        }

        return new RosError(status, detail, command, rawBody);
    }

    /**
     * Custom generic JSON representation for logging systems (DataDog, Sentry, etc.)
     */
    public toJSON() {
        return {
            errorType: 'RosError',
            status: this.status,
            message: this.message,
            detail: this.detail,
            command: this.command,
            isRetryable: this.isRetryable,
            timestamp: this.timestamp
        };
    }
}