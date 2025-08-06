import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test file patterns
    include: [
      'tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**'
    ],
    
    // Test environment
    environment: 'node',
    
    // Timeouts (E2E tests can be slow)
    testTimeout: 60000,  // 60 seconds
    hookTimeout: 30000,  // 30 seconds
    
    // Global test configuration
    globals: true,
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'tests/**',
        'node_modules/**',
        'dist/**',
        'build/**',
        '**/*.d.ts',
        'vitest.config.ts',
        'build.js'
      ]
    },
    
    // Reporters
    reporters: ['verbose', 'json'],
    outputFile: {
      json: './test-results.json'
    },
    
    // Sequential execution for E2E tests to avoid port conflicts
    sequence: {
      concurrent: false
    },
    
    // Pool options for better resource management
    pool: 'threads',
    isolate: true,
    
    // Setup files (run for each test file but with proper coordination)
    setupFiles: ['./tests/setup.ts']
  },
  
  // Resolve configuration
  resolve: {
    alias: {
      '@': './src',
      '@tests': './tests'
    }
  }
});