/**
 * RosInterface
 * ==========================================
 * The Enterprise-Grade Mikrotik RouterOS API Client for Node.js.
 *
 * This library provides a high-performance, Offline-First, and Type-Safe interface
 * for managing Mikrotik devices. It features Smart Caching, Connection Pooling,
 * and Auto-Topology discovery for RouterOS v6 and v7.
 *
 * @packageDocumentation
 * @module RosInterface
 */

// ===============================================
// 1. MAIN CLIENTS (Primary Entry Points)
// ===============================================

/**
 * The main client class.
 * Use this to establish a single connection to a Mikrotik router.
 * It manages authentication, command execution, and streaming.
 */
export { MikrotikClient, MikrotikOptions, Subscription } from './client/MikrotikClient';

/**
 * Connection Pool Manager.
 * Use this for high-concurrency environments. It opens multiple sockets
 * to the same router and uses a Round-Robin algorithm to distribute the load.
 */
export { MikrotikPool, PoolOptions } from './client/MikrotikPool';

/**
 * The Fluent API Engine.
 * Returned by `client.command()`. Allows chaining methods like `.where()`, `.select()`,
 * `.persistent()`, and `.write()`.
 */
export { CommandBuilder } from './client/CommandBuilder';

// ===============================================
// 2. FEATURES & TOOLS
// ===============================================

/**
 * Prometheus Metrics Utility.
 * Static helper to convert RouterOS data into Prometheus-compatible formats
 * (Gauge/Counter) for monitoring dashboards (Grafana).
 */
export { PrometheusExporter, MetricDefinition, MetricType } from './features/PrometheusExporter';

/**
 * File Manager.
 * Handles uploading and downloading files to the router's internal storage.
 * Accessed via `client.files`.
 */
export { FileManager } from './features/FileManager';

// ===============================================
// 3. CORE CONFIGURATION & TYPES
// ===============================================

/**
 * Circuit Breaker Configuration.
 * Manages the fault tolerance logic. Defines states (OPEN, CLOSED) and
 * reset timeouts for the offline-first mechanism.
 */
export { CircuitBreaker, CircuitBreakerOptions, CircuitBreakerState } from './core/CircuitBreaker';

/**
 * Rate Limiter Class.
 * Implements the Token Bucket algorithm to protect the router's CPU
 * from being overwhelmed by too many requests.
 */
export { RateLimiter } from './core/RateLimiter';

/**
 * Schema Mapper Class.
 * Responsible for detecting RouterOS versions (v6 vs v7) and translating
 * abstract paths (e.g., 'wifi') to concrete paths.
 */
export { SchemaMapper } from './core/SchemaMapper';

// ===============================================
// 4. UTILITIES & DATA STRUCTURES
// ===============================================

/**
 * Result Parser.
 * Utility to transform raw Mikrotik API sentences into JavaScript Objects.
 * (Mostly used internally, but exported for advanced custom implementations).
 */
export { ResultParser } from './client/ResultParser';

/**
 * Smart Collection Wrapper.
 * Wraps the array of results returned by the router.
 * Provides in-memory methods like `.filterBy()`, `.first()`, `.search()`, and `.count()`.
 */
export { MikrotikCollection } from './utils/MikrotikCollection';

/**
 * General Helper Functions.
 * string manipulation utilities used throughout the library.
 */
export * from './utils/Helpers';
