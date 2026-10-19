#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compile } from './compiler.js';

async function main() {
  const args = process.argv.slice(2);
  const input = args.find(a => !a.startsWith('--'));
  const outIndex = args.indexOf('--out');
  const outDir = outIndex >= 0 ? args[outIndex + 1] : 'dist';
  if (!input) {
    console.error('Usage: forma <file.forma> [--out directory]');
    process.exitCode = 1;
    return;
  }
  try {
    const source = await readFile(input, 'utf8');
    const result = compile(source);
    await mkdir(outDir, { recursive: true });
    await Promise.all([
      writeFile(path.join(outDir, 'index.html'), result.html),
      writeFile(path.join(outDir, 'style.css'), result.css),
    ]);
    console.log(`Forma compiled ${input} → ${outDir}/index.html`);
  } catch (error) {
    console.error(`Forma build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
main();
