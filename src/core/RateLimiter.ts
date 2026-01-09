/**
 * RateLimiter.ts
 * Implements a Token Bucket algorithm with Smart Backoff.
 * * * Purpose:
 * Protects the MikroTik router CPU from being overwhelmed by too many concurrent requests.
 * It dynamically adjusts the request rate based on the router's response time (latency).
 */
export class RateLimiter {
    // Configuration
    private readonly maxTokens: number;
    private refillRate: number; // Tokens per second
    private readonly minRefillRate: number = 2; // Never stop completely, but go very slow
    private readonly originalRefillRate: number;

    // State
    private tokens: number;
    private queue: Array<() => void> = [];
    private rttHistory: number[] = [];
    private readonly historySize = 10; // Keep last 10 requests to calculate average

    // Health Thresholds (in milliseconds)
    private readonly LATENCY_THRESHOLD_WARNING = 200; // >200ms = Router is busy
    private readonly LATENCY_THRESHOLD_CRITICAL = 500; // >500ms = Router is dying

    constructor(limitPerSecond: number = 50, burstSize: number = 10) {
        this.refillRate = limitPerSecond;
        this.originalRefillRate = limitPerSecond;
        this.maxTokens = burstSize;
        this.tokens = burstSize;

        // Start the refill loop
        setInterval(() => this.refillTokens(), 100); // Check every 100ms
    }

    /**
     * Attempts to acquire a token to send a command.
     * If tokens are available, resolves immediately.
     * If not, queues the request until a token is generated.
     */
    public async acquire(): Promise<void> {
        if (this.tokens >= 1) {
            this.tokens -= 1;
            return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
            this.queue.push(resolve);
        });
    }

    /**
     * Feeds back the execution time of a command to the limiter.
     * This allows the "Smart Backoff" engine to detect congestion.
     * @param durationMs Time in ms from sending command to receiving !done
     */
    public submitFeedback(durationMs: number): void {
        this.rttHistory.push(durationMs);
        if (this.rttHistory.length > this.historySize) {
            this.rttHistory.shift();
        }
        this.adjustHealth();
    }

    /**
     * Internal Loop: Refills tokens based on current health.
     */
    private refillTokens(): void {
        // Calculate how many tokens to add in this 100ms interval
        const tokensToAdd = this.refillRate / 10;

        this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);

        // Process pending queue
        while (this.queue.length > 0 && this.tokens >= 1) {
            this.tokens -= 1;
            const nextResolve = this.queue.shift();
            if (nextResolve) nextResolve();
        }
    }

    /**
     * SMART BACKOFF ENGINE
     * Analyzes the RTT history and adjusts the refill rate (speed).
     */
    private adjustHealth(): void {
        if (this.rttHistory.length < 5) return; // Need minimal data

        // Calculate Average Latency
        const avgLatency = this.rttHistory.reduce((a, b) => a + b, 0) / this.rttHistory.length;

        // 1. CRITICAL STATE (Exponential Backoff)
        if (avgLatency > this.LATENCY_THRESHOLD_CRITICAL) {
            // Drop speed drastically to minimum
            this.refillRate = this.minRefillRate;
            // Clear tokens to force a pause
            this.tokens = 0;
            if (Math.random() > 0.9) console.warn(`[RateLimiter] High Congestion! Latency: ${avgLatency.toFixed(0)}ms. Throttling down.`);
        }
        // 2. WARNING STATE (Linear Backoff)
        else if (avgLatency > this.LATENCY_THRESHOLD_WARNING) {
            // Reduce speed by half
            this.refillRate = Math.max(this.minRefillRate, this.originalRefillRate / 2);
        }
        // 3. HEALTHY STATE (Recovery)
        else {
            // Gradually recover speed (don't jump instantly to avoid oscillation)
            if (this.refillRate < this.originalRefillRate) {
                this.refillRate += 5; // Recover 5 tokens/sec per check
            }
        }
    }
}