export declare class RateLimiter {
    private readonly maxTokens;
    private refillRate;
    private readonly minRefillRate;
    private readonly originalRefillRate;
    private tokens;
    private queue;
    private rttHistory;
    private readonly historySize;
    private readonly LATENCY_THRESHOLD_WARNING;
    private readonly LATENCY_THRESHOLD_CRITICAL;
    constructor(limitPerSecond?: number, burstSize?: number);
    acquire(): Promise<void>;
    submitFeedback(durationMs: number): void;
    private refillTokens;
    private adjustHealth;
}
