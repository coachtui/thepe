/**
 * Debug logging utility for development and production environments
 *
 * Usage:
 *   import { debug } from '@/lib/utils/debug'
 *   debug.vision('Processing page 1')
 *   debug.query('Running fuzzy search')
 *
 * Control via environment variable:
 *   DEBUG=vision,query  (enable specific modules)
 *   DEBUG=*             (enable all modules)
 *   DEBUG=             (disable all debug logs - production default)
 */

type DebugModule =
  | 'vision'
  | 'query'
  | 'chat'
  | 'processing'
  | 'extraction'
  | 'database'
  | 'cost'
  | 'api';

class DebugLogger {
  private enabledModules: Set<string>;
  private enableAll: boolean;

  constructor() {
    const debugEnv = process.env.DEBUG || process.env.NEXT_PUBLIC_DEBUG || '';

    if (debugEnv === '*') {
      this.enableAll = true;
      this.enabledModules = new Set();
    } else {
      this.enableAll = false;
      this.enabledModules = new Set(
        debugEnv.split(',').map(m => m.trim()).filter(Boolean)
      );
    }
  }

  private isEnabled(module: DebugModule): boolean {
    return this.enableAll || this.enabledModules.has(module);
  }

  private log(module: DebugModule, ...args: any[]) {
    if (this.isEnabled(module)) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [${module.toUpperCase()}]`, ...args);
    }
  }

  // Module-specific logging methods
  vision = (...args: any[]) => this.log('vision', ...args);
  query = (...args: any[]) => this.log('query', ...args);
  chat = (...args: any[]) => this.log('chat', ...args);
  processing = (...args: any[]) => this.log('processing', ...args);
  extraction = (...args: any[]) => this.log('extraction', ...args);
  database = (...args: any[]) => this.log('database', ...args);
  cost = (...args: any[]) => this.log('cost', ...args);
  api = (...args: any[]) => this.log('api', ...args);

  // Always log errors and warnings (production-safe)
  error = (module: DebugModule, ...args: any[]) => {
    console.error(`[ERROR] [${module.toUpperCase()}]`, ...args);
  };

  warn = (module: DebugModule, ...args: any[]) => {
    console.warn(`[WARN] [${module.toUpperCase()}]`, ...args);
  };

  // Always log important info (production-safe)
  info = (module: DebugModule, ...args: any[]) => {
    console.log(`[INFO] [${module.toUpperCase()}]`, ...args);
  };
}

export const debug = new DebugLogger();

/**
 * Production-safe logging for critical events
 * Always logs regardless of DEBUG flag
 */
export const logProduction = {
  error: (context: string, error: any, metadata?: Record<string, any>) => {
    console.error(`[ERROR] ${context}:`, error, metadata || '');
  },

  warn: (context: string, message: string, metadata?: Record<string, any>) => {
    console.warn(`[WARN] ${context}: ${message}`, metadata || '');
  },

  info: (context: string, message: string, metadata?: Record<string, any>) => {
    console.log(`[INFO] ${context}: ${message}`, metadata || '');
  },

  cost: (context: string, cost: number, metadata?: Record<string, any>) => {
    console.log(`[COST] ${context}: $${cost.toFixed(4)}`, metadata || '');
  },

  metric: (context: string, metric: string, value: number | string, metadata?: Record<string, any>) => {
    console.log(`[METRIC] ${context} - ${metric}: ${value}`, metadata || '');
  }
};
