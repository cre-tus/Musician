'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { searchFiles, searchInFiles } = require('../electron/workspace-search');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mudex-search-test-'));
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'node_modules', 'ignored'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'const value = 1;\nconst message = "Needle found";\n// needle again\n', 'utf8');
    fs.writeFileSync(path.join(root, 'node_modules', 'ignored', 'lib.js'), 'needle should not be indexed', 'utf8');
    fs.writeFileSync(path.join(root, 'image.bin'), Buffer.from([0, 1, 2, 3]));
    fs.writeFileSync(path.join(root, 'src', 'FileExplorer.tsx'), 'export const Explorer = true;\n', 'utf8');
    fs.writeFileSync(path.join(root, 'docs', 'feature-catalog.md'), 'Feature catalog\n', 'utf8');
    const longDirectory = `d${'x'.repeat(150)}`;
    fs.mkdirSync(path.join(root, longDirectory), { recursive: true });
    fs.writeFileSync(path.join(root, longDirectory, 'Target.ts'), 'export const target = true;\n', 'utf8');

    const result = await searchInFiles(root, 'NEEDLE');
    assert.equal(result.ok, true);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.matches.map((match) => [match.relativePath, match.lineNumber]), [
      ['src/app.ts', 2],
      ['src/app.ts', 3],
    ]);
    assert.equal(result.matches[0].lineText, 'const message = "Needle found";');

    const fuzzy = await searchFiles(root, 'fex');
    assert.equal(fuzzy.ok, true);
    assert.equal(fuzzy.files[0].relativePath, 'src/FileExplorer.tsx');
    const multiToken = await searchFiles(root, 'feat cat');
    assert.equal(multiToken.ok, true);
    assert.ok(multiToken.files.some((file) => file.relativePath === 'docs/feature-catalog.md'));
    const longPathFuzzy = await searchFiles(root, 'dt');
    assert.equal(longPathFuzzy.ok, true);
    assert.ok(longPathFuzzy.files.some((file) => file.relativePath === `${longDirectory}/Target.ts`));

    fs.writeFileSync(path.join(root, 'large.txt'), `needle at the start\n${'x'.repeat(512 * 1024)}`, 'utf8');
    const bounded = await searchInFiles(root, 'needle');
    assert.equal(bounded.ok, true);
    assert.equal(bounded.truncated, true);
    assert.ok(bounded.matches.some((match) => match.relativePath === 'src/app.ts'));

    const empty = await searchInFiles(root, '  ');
    assert.deepEqual(empty, { ok: true, matches: [], truncated: false });
    const tooLong = await searchInFiles(root, 'x'.repeat(241));
    assert.deepEqual(tooLong, { ok: false, error: 'QUERY_TOO_LONG' });
    process.stdout.write('Workspace content search checks passed.\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
