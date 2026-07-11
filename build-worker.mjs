import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. Read jsQR full implementation
const jsQRPath = path.join(__dirname, 'node_modules', 'jsqr-es6', 'dist', 'jsQR.js');
let jsQRCode = fs.readFileSync(jsQRPath, 'utf8');

// Remove export and sourcemap lines
const lines = jsQRCode.split('\n');
const cleaned = lines.filter(l => 
  !l.startsWith('export { ') && 
  !l.startsWith('//# sourceMappingURL=')
).join('\n');

// 2. Transpile worker.ts to JS using esbuild
const workerResult = await esbuild.transform(
  fs.readFileSync(path.join(__dirname, 'src', 'worker.ts'), 'utf8'),
  { loader: 'ts', target: 'es2017' }
);
let workerJS = workerResult.code;
// Remove the import statement (jsQR was already inlined)
workerJS = workerJS.replace(/import\s+jsQR\s+from\s+['"]jsqr-es6['"];?\s*/g, '');

// 3. Combine: jsQR code + worker message handler
const combined = cleaned + '\n' + workerJS;

// 4. Wrap in the createWorker export format
const wrapped = 'export const createWorker=()=>new Worker(URL.createObjectURL(new Blob([`'
  + combined.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\${/g, '\\${')
  + '`]),{type:"application/javascript"}))';

// 5. Write output files
fs.writeFileSync(path.join(__dirname, 'qr-scanner-worker.min.js'), wrapped);
fs.writeFileSync(path.join(__dirname, 'src', 'qr-scanner-worker.min.js'), wrapped);
// Also save raw combined for debugging
fs.writeFileSync(path.join(__dirname, 'src', 'qr-scanner-worker.raw.js'), combined);

console.log('Worker built successfully!');
console.log('Wrapped size:', wrapped.length, 'bytes');
console.log('Raw size:', combined.length, 'bytes');
