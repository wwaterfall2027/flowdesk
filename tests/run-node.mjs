// CI entry point: node tests/run-node.mjs (exits 1 on any failure)
import { run } from './signals.test.js';
const r = run();
for (const x of r) console.log(`${x.ok ? 'ok  ' : 'FAIL'} ${x.name}${x.ok ? '' : ' :: ' + x.err}`);
const failed = r.filter((x) => !x.ok).length;
console.log(`${r.length - failed}/${r.length} passing`);
process.exit(failed ? 1 : 0);
