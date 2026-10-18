// Runs the tests on any Node version (18, 20, 22) and any computer:  node test/run.js unit   |   node test/run.js integration
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const kind = process.argv[2] || 'unit';
const dir = path.join(__dirname, kind);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).map((f) => path.join(dir, f));
if (!files.length) { console.error('No test files in', dir); process.exit(1); }
const r = spawnSync(process.execPath, ['--test', ...(kind === 'integration' ? ['--test-concurrency=1'] : []), ...files], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
