"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CircuitBreaker = exports.CircuitBreakerState = void 0;
var CircuitBreakerState;
(function (CircuitBreakerState) {
    CircuitBreakerState[CircuitBreakerState["CLOSED"] = 0] = "CLOSED";
    CircuitBreakerState[CircuitBreakerState["OPEN"] = 1] = "OPEN";
    CircuitBreakerState[CircuitBreakerState["HALF_OPEN"] = 2] = "HALF_OPEN";
})(CircuitBreakerState || (exports.CircuitBreakerState = CircuitBreakerState = {}));
class CircuitBreaker {
    constructor(options = {}) {
        this.state = CircuitBreakerState.CLOSED;
        this.failureCount = 0;
        this.lastFailureTime = 0;
        this.failureThreshold = options.failureThreshold || 5;
        this.resetTimeout = options.resetTimeout || 10000;
    }
    async execute(action) {
        if (this.state === CircuitBreakerState.OPEN) {
            if (this.isResetTimeoutExpired()) {
                this.transitionTo(CircuitBreakerState.HALF_OPEN);
            }
            else {
                const timeLeft = this.resetTimeout - (Date.now() - this.lastFailureTime);
                throw new Error(`CircuitBreaker is OPEN. Fast-failing. Retry in ${timeLeft}ms.`);
            }
        }
        try {
            const result = await action();
            return this.onSuccess(result);
        }
        catch (error) {
            return this.onFailure(error);
        }
    }
    onSuccess(result) {
        if (this.state === CircuitBreakerState.HALF_OPEN) {
            this.transitionTo(CircuitBreakerState.CLOSED);
        }
        this.failureCount = 0;
        return result;
    }
    onFailure(error) {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.state === CircuitBreakerState.HALF_OPEN || this.failureCount >= this.failureThreshold) {
            this.transitionTo(CircuitBreakerState.OPEN);
        }
        throw error;
    }
    transitionTo(newState) {
        this.state = newState;
        const stateName = CircuitBreakerState[newState];
        console.warn(`[CircuitBreaker] State changed to: ${stateName}`);
    }
    isResetTimeoutExpired() {
        return (Date.now() - this.lastFailureTime) > this.resetTimeout;
    }
    getState() {
        return this.state;
    }
}
exports.CircuitBreaker = CircuitBreaker;
//# sourceMappingURL=CircuitBreaker.js.map