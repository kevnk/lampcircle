import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Node's type stripper does not resolve extensionless specifiers. Src keeps those so Vite still compiles.
export function registerTsHooks(): void {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('.') && !/\.(mjs|cjs|js|json|ts|tsx|node)$/.test(specifier)) {
        const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
        const base = path.resolve(path.dirname(parentPath), specifier);
        for (const file of [base + '.ts', path.join(base, 'index.ts')]) {
          if (existsSync(file)) {
            return { url: pathToFileURL(file).href, shortCircuit: true };
          }
        }
      }
      return nextResolve(specifier, context);
    },
  });
}
