/**
 * CircuitBreakerState Enum
 * Defines the possible states of the protection mechanism.
 */
export enum CircuitBreakerState {
    /** Normal operation. Requests pass through. */
    CLOSED,
    /** Failure threshold reached. Requests are blocked immediately. */
    OPEN,
    /** Cool-down period over. A test request is allowed to check health. */
    HALF_OPEN
}

export interface CircuitBreakerOptions {
    /** Number of failures allowed before opening the circuit (Default: 5) */
    failureThreshold?: number;
    /** Time in ms to wait before trying to reconnect (Default: 10000ms) */
    resetTimeout?: number;
}

/**
 * CircuitBreaker
 * * Implements the classic stability pattern.
 * * Wraps potentially dangerous network calls.
 * * If the router fails repeatedly, the breaker "trips" and prevents further load
 * until the system recovers.
 */
export class CircuitBreaker {
    private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
    private failureCount: number = 0;
    private lastFailureTime: number = 0;

    private readonly failureThreshold: number;
    private readonly resetTimeout: number;

    constructor(options: CircuitBreakerOptions = {}) {
        this.failureThreshold = options.failureThreshold || 5;
        this.resetTimeout = options.resetTimeout || 10000;
    }

    /**
     * Executes an async action (like client.connect() or client.write())
     * through the safety mechanism of the breaker.
     */
    public async execute<T>(action: () => Promise<T>): Promise<T> {
        // 1. Check State
        if (this.state === CircuitBreakerState.OPEN) {
            if (this.isResetTimeoutExpired()) {
                this.transitionTo(CircuitBreakerState.HALF_OPEN);
            } else {
                const timeLeft = this.resetTimeout - (Date.now() - this.lastFailureTime);
                throw new Error(`CircuitBreaker is OPEN. Fast-failing. Retry in ${timeLeft}ms.`);
            }
        }

        // 2. Attempt Execution
        try {
            const result = await action();
            return this.onSuccess(result);
        } catch (error) {
            return this.onFailure(error as Error);
        }
    }

    /**
     * Handles successful execution. Resets failure counts.
     */
    private onSuccess<T>(result: T): T {
        if (this.state === CircuitBreakerState.HALF_OPEN) {
            this.transitionTo(CircuitBreakerState.CLOSED);
        }
        this.failureCount = 0;
        return result;
    }

    /**
     * Handles execution failures. Trips the breaker if needed.
     */
    private onFailure(error: Error): never {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.state === CircuitBreakerState.HALF_OPEN || this.failureCount >= this.failureThreshold) {
            this.transitionTo(CircuitBreakerState.OPEN);
        }

        throw error;
    }

    private transitionTo(newState: CircuitBreakerState): void {
        this.state = newState;
        const stateName = CircuitBreakerState[newState];
        console.warn(`[CircuitBreaker] State changed to: ${stateName}`);
    }

    private isResetTimeoutExpired(): boolean {
        return (Date.now() - this.lastFailureTime) > this.resetTimeout;
    }

    public getState(): CircuitBreakerState {
        return this.state;
    }
}