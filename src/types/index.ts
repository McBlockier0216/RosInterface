/**
 * RosInterface
 * Modern, Promise-based, and Enterprise-grade MikroTik RouterOS API Client for Node.js.
 */

// ===============================================
// MAIN CLIENTS
// ===============================================
export { MikrotikClient, MikrotikOptions, Subscription } from '../client/MikrotikClient';
export { MikrotikPool, PoolOptions } from '../client/MikrotikPool';
export { CommandBuilder } from '../client/CommandBuilder';

// ===============================================
// FEATURES & TOOLS
// ===============================================
// Prometheus Exporter (Static Utility)
export { PrometheusExporter, MetricDefinition, MetricType } from '../features/PrometheusExporter';

// File Manager (Class Type for TypeScript users)
export { FileManager } from '../features/FileManager';

// ===============================================
// CORE CONFIGURATION & TYPES
// ===============================================
// Circuit Breaker (Enums & Options needed for configuration)
export { CircuitBreaker, CircuitBreakerOptions, CircuitBreakerState } from '../core/CircuitBreaker';

// Rate Limiter (Class Type)
export { RateLimiter } from '../core/RateLimiter';

// Auto-Topology (Schema Type)
export { SchemaMapper } from '../core/SchemaMapper';

// ===============================================
// UTILITIES & DATA STRUCTURES
// ===============================================
export { ResultParser } from '../client/ResultParser';
export { MikrotikCollection } from '../utils/MikrotikCollection';
export * from '../utils/Helpers';

// ===============================================
// LOW-LEVEL COMPONENTS
// ===============================================
export { SocketClient, SocketClientOptions } from '../core/SocketClient';
export { RosProtocol } from '../core/RosProtocol';
export { Auth } from '../core/Auth';