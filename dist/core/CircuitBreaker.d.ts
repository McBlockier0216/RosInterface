export declare enum CircuitBreakerState {
    CLOSED = 0,
    OPEN = 1,
    HALF_OPEN = 2
}
export interface CircuitBreakerOptions {
    failureThreshold?: number;
    resetTimeout?: number;
}
export declare class CircuitBreaker {
    private state;
    private failureCount;
    private lastFailureTime;
    private readonly failureThreshold;
    private readonly resetTimeout;
    constructor(options?: CircuitBreakerOptions);
    execute<T>(action: () => Promise<T>): Promise<T>;
    private onSuccess;
    private onFailure;
    private transitionTo;
    private isResetTimeoutExpired;
    getState(): CircuitBreakerState;
}
