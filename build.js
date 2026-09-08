// build.js - Production build script for King's Landing
// Bundles all JS into dist/game.js (IIFE format) and outputs standalone dist/index.html

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = __dirname;
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const SRC_DIR = path.join(ROOT_DIR, 'src');

console.log('--- Building King\'s Landing for production ---');

// 1. Prepare clean dist directory
if (fs.existsSync(DIST_DIR)) {
  console.log('Cleaning existing dist directory...');
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DIST_DIR, { recursive: true });

// 2. Create temporary entry file inside dist/ to avoid polluting root
const tempEntryRel = './dist/.build-entry.js';
const tempEntryPath = path.join(ROOT_DIR, 'dist', '.build-entry.js');
const entryCode = `import { boot } from '../src/main.js';

boot().catch(error => {
  const box = document.getElementById('fatal');
  if (box) {
    box.style.display = 'grid';
    box.textContent = (error && error.stack) || String(error);
  }
  console.error(error);
});
`;

fs.writeFileSync(tempEntryPath, entryCode, 'utf8');

try {
  // 3. Bundle and minify all JavaScript using esbuild
  // Using IIFE format so the game can be opened directly via file:// (double-click)
  // as well as deployed to any static web server without CORS issues.
  console.log('Bundling and minifying JavaScript into dist/game.js (IIFE)...');

  // Use relative paths to prevent any issues with spaces in absolute paths
  const esbuildCmd = `npx -y esbuild "${tempEntryRel}" --bundle --minify --format=iife --target=es2020 --alias:three="./vendor/three.module.js" --outfile="./dist/game.js"`;

  execSync(esbuildCmd, {
    cwd: ROOT_DIR,
    stdio: 'inherit'
  });
} finally {
  // Ensure temporary entry file is cleaned up even if build fails
  if (fs.existsSync(tempEntryPath)) {
    fs.unlinkSync(tempEntryPath);
  }
}

// 4. Process and inline dependencies into dist/index.html
console.log('Processing index.html...');
let html = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');

// Ensure title is King's Landing
html = html.replace(/<title>.*?<\/title>/i, "<title>King's Landing</title>");

// Remove importmap (Three.js is bundled into game.js)
const importMapRegex = /<!--[\s\S]*?-->\s*<script type="importmap">[\s\S]*?<\/script>\s*/i;
if (!importMapRegex.test(html)) {
  console.warn('Warning: importmap block was not found or already removed.');
}
html = html.replace(importMapRegex, '');

// Inline theme.css
const themeCssPath = path.join(SRC_DIR, 'ui', 'theme.css');
if (fs.existsSync(themeCssPath)) {
  const themeCss = fs.readFileSync(themeCssPath, 'utf8');
  const linkCssRegex = /<link\s+rel=["']stylesheet["']\s+href=["']\.\/src\/ui\/theme\.css["']\s*\/?>/i;
  if (!linkCssRegex.test(html)) {
    throw new Error('Could not find theme.css link tag in index.html to inline.');
  }
  html = html.replace(linkCssRegex, `<style>\n/* src/ui/theme.css */\n${themeCss}\n</style>`);
}

// Inline SVGs as data URIs so no external SVG files are needed
const svgFiles = [
  { placeholder: './src/ui/archer.svg', file: path.join(SRC_DIR, 'ui', 'archer.svg') },
  { placeholder: './src/ui/barricade.svg', file: path.join(SRC_DIR, 'ui', 'barricade.svg') },
  { placeholder: './src/ui/castle.svg', file: path.join(SRC_DIR, 'ui', 'castle.svg') }
];

for (const { placeholder, file } of svgFiles) {
  if (fs.existsSync(file)) {
    const svgData = fs.readFileSync(file);
    const base64Uri = `data:image/svg+xml;base64,${svgData.toString('base64')}`;
    html = html.replaceAll(placeholder, base64Uri);
  } else {
    throw new Error(`Required SVG asset missing: ${file}`);
  }
}

// Replace the entry module script with non-module deferred script for file:// and http:// support
const scriptRegex = /<script type="module">\s*import\s*\{[^}]*\}\s*from\s*['"]\.\/src\/main\.js['"];[\s\S]*?<\/script>/i;
if (!scriptRegex.test(html)) {
  throw new Error('Could not find entry module script in index.html to replace.');
}
html = html.replace(scriptRegex, '<script defer src="game.js"></script>');

// 5. Post-build verification assertions
console.log('Running post-build validation...');
if (html.includes('./src/')) {
  throw new Error('Build error: Unresolved ./src/ references remain in dist/index.html!');
}
if (html.includes('./vendor/')) {
  throw new Error('Build error: Unresolved ./vendor/ references remain in dist/index.html!');
}
if (html.includes('importmap')) {
  throw new Error('Build error: importmap still remains in dist/index.html!');
}

const distHtmlPath = path.join(DIST_DIR, 'index.html');
fs.writeFileSync(distHtmlPath, html, 'utf8');

const distJsPath = path.join(DIST_DIR, 'game.js');
if (!fs.existsSync(distJsPath) || fs.statSync(distJsPath).size === 0) {
  throw new Error('Build error: dist/game.js was not generated or is empty!');
}

// 6. Report build statistics
console.log('\nBuild successful! Contents of dist/:');
const distFiles = fs.readdirSync(DIST_DIR);
let totalSize = 0;
for (const file of distFiles) {
  const filePath = path.join(DIST_DIR, file);
  const stats = fs.statSync(filePath);
  totalSize += stats.size;
  const kb = (stats.size / 1024).toFixed(1);
  console.log(` - ${file.padEnd(20)} ${kb.padStart(8)} KB`);
}
console.log(`Total build size: ${(totalSize / 1024).toFixed(1)} KB`);
console.log("Game title is \"King's Landing\".");
console.log('Standalone: playable both via local web servers and double-clicking file://.');
