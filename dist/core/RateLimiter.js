"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimiter = void 0;
class RateLimiter {
    constructor(limitPerSecond = 50, burstSize = 10) {
        this.minRefillRate = 2;
        this.queue = [];
        this.rttHistory = [];
        this.historySize = 10;
        this.LATENCY_THRESHOLD_WARNING = 200;
        this.LATENCY_THRESHOLD_CRITICAL = 500;
        this.refillRate = limitPerSecond;
        this.originalRefillRate = limitPerSecond;
        this.maxTokens = burstSize;
        this.tokens = burstSize;
        setInterval(() => this.refillTokens(), 100);
    }
    async acquire() {
        if (this.tokens >= 1) {
            this.tokens -= 1;
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.queue.push(resolve);
        });
    }
    submitFeedback(durationMs) {
        this.rttHistory.push(durationMs);
        if (this.rttHistory.length > this.historySize) {
            this.rttHistory.shift();
        }
        this.adjustHealth();
    }
    refillTokens() {
        const tokensToAdd = this.refillRate / 10;
        this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
        while (this.queue.length > 0 && this.tokens >= 1) {
            this.tokens -= 1;
            const nextResolve = this.queue.shift();
            if (nextResolve)
                nextResolve();
        }
    }
    adjustHealth() {
        if (this.rttHistory.length < 5)
            return;
        const avgLatency = this.rttHistory.reduce((a, b) => a + b, 0) / this.rttHistory.length;
        if (avgLatency > this.LATENCY_THRESHOLD_CRITICAL) {
            this.refillRate = this.minRefillRate;
            this.tokens = 0;
            if (Math.random() > 0.9)
                console.warn(`[RateLimiter] High Congestion! Latency: ${avgLatency.toFixed(0)}ms. Throttling down.`);
        }
        else if (avgLatency > this.LATENCY_THRESHOLD_WARNING) {
            this.refillRate = Math.max(this.minRefillRate, this.originalRefillRate / 2);
        }
        else {
            if (this.refillRate < this.originalRefillRate) {
                this.refillRate += 5;
            }
        }
    }
}
exports.RateLimiter = RateLimiter;
//# sourceMappingURL=RateLimiter.js.map