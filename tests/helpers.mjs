// Loads the classic (non-module) browser scripts into Node's global scope.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function load(file) {
    vm.runInThisContext(readFileSync(join(root, file), 'utf8'), { filename: file });
}

export function memoryStore() {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
        _map: m
    };
}
