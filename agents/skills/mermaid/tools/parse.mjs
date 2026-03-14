import fs from 'node:fs';
import { JSDOM } from 'jsdom';

// Mermaid expects a browser DOM environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;
Object.defineProperty(global, 'navigator', {
    value: dom.window.navigator,
    writable: true,
    configurable: true,
});

const { default: createDOMPurify } = await import('dompurify');
global.DOMPurify = createDOMPurify(dom.window);

const { default: mermaid } = await import('mermaid');

const input = process.argv[2];
if (!input) {
    console.error('Usage: node parse.mjs <diagram.mmd>');
    process.exit(1);
}

mermaid.initialize({ startOnLoad: false });
const text = fs.readFileSync(input, 'utf8');
try {
    await mermaid.parse(text);
    console.log('✓ Mermaid syntax OK');
} catch (err) {
    console.error('✗ Mermaid syntax error:');
    console.error(err.message || err);
    process.exit(1);
}
