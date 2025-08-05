# Claude Development Guidelines

## Language & Style

- **TypeScript required** - Use strict TypeScript with strong typing
- **Node.js imports** - Always use `"node:"` prefix: `import { readFileSync } from "node:fs"`
- **Modern JS** - Prefer async/await, optional chaining (`?.`), nullish coalescing (`??`)
- **ESM syntax** - Use ES module import/export throughout

## Naming Conventions

- **Classes**: PascalCase (`ConfigManager`, `QidoHandler`)
- **Methods/Variables**: camelCase (`getHandler`, `dimseClient`)
- **Constants**: SCREAMING_SNAKE_CASE (`BASE_BUILD_DIR`)
- **Files**: kebab-case (`file-cache.ts`, `config-manager.ts`)

## Code Patterns

### Error Handling
```typescript
try {
  const result = await operation();
} catch (error) {
  console.error('Context:', error);
  this.sendError(res, 500, 'User-friendly message');
}
```

### Standard Error Response
```typescript
{
  error: string,
  statusCode: number,
  timestamp: string
}
```

### Handler Pattern
```typescript
export class SomeHandler {
  constructor(private config: ProxyConfig) {}
  
  public getHandler(): RequestHandler {
    return async (req, res) => {
      // Implementation
    };
  }
}
```

## Project-Specific

- **DICOM terminology** - Use proper terms: StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID
- **Configuration** - Support JSONC (JSON with comments), validate early
- **Multi-runtime** - Support Deno (default), Bun, Node.js builds
- **File organization** - Group by feature: `cache/`, `dimse/`, `handlers/`, `server/`

## Build Commands

- `node build.js` - Deno build (default)
- `node build.js --bun` - Force Bun
- `node build.js --node` - Force Node.js
- `node build.js --rhel` - RHEL deployment build