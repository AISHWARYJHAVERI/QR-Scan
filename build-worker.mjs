import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function build() {
    // Bundle worker.ts with zxing-wasm/reader using esbuild
    const result = await esbuild.build({
        entryPoints: [path.join(__dirname, 'src', 'worker.ts')],
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2017',
        sourcemap: false,
        minifyWhitespace: true,
        minifyIdentifiers: true,
        minifySyntax: true,
        write: false,
        external: [], // bundle everything including zxing-wasm
    });

    let code = result.outputFiles[0].text;

    // Wrap in the createWorker export format (module worker)
    const wrapped = 'export const createWorker=()=>new Worker(URL.createObjectURL(new Blob([`'
        + code.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\${/g, '\\${')
        + '`]),{type:"module"}))';

    // Write output files
    fs.writeFileSync(path.join(__dirname, 'qr-scanner-worker.min.js'), wrapped);
    fs.writeFileSync(path.join(__dirname, 'src', 'qr-scanner-worker.min.js'), wrapped);

    console.log('Worker built successfully!');
    console.log('Wrapped size:', wrapped.length, 'bytes');
    console.log('Raw bundle size:', code.length, 'bytes');
}

build().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
});
