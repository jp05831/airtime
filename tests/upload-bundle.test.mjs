import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

const project = fileURLToPath(new URL("../", import.meta.url));
const route = ".next/server/app/api/creator/upload/finalize/route.js";
const linux = "node_modules/@ffprobe-installer/linux-x64";
const supported = process.platform === "linux" && process.arch === "x64";
const run = promisify(execFile);

async function tracedBundle(t) {
  const root = await mkdtemp(join(tmpdir(), "airtime-upload-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tracePath = resolve(project, `${route}.nft.json`);
  const trace = JSON.parse(await readFile(tracePath, "utf8"));
  const files = new Set([
    route,
    ...trace.files.map((file) =>
      relative(project, resolve(dirname(tracePath), file)),
    ),
  ]);
  for (const file of [`${linux}/package.json`, `${linux}/ffprobe`])
    assert.ok(files.has(file), `Upload deployment trace is missing ${file}`);
  // Reconstruct ONLY traced files in /tmp. No symlinks, source node_modules,
  // dev dependencies, .env.local or NODE_PATH fallback can rescue the bundle.
  for (const file of files) {
    assert.ok(!file.startsWith(".."), `Trace escapes the project: ${file}`);
    const destination = join(root, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(project, file), destination);
  }
  return root;
}

async function inBundle(root, source) {
  return run(
    process.execPath,
    [
      "--eval",
      `(async () => { ${source} })().catch(error => { console.error(error); process.exitCode = 1; });`,
    ],
    {
      cwd: root,
      env: { NODE_ENV: "production", NODE_PATH: "", PATH: process.env.PATH },
      timeout: 30000,
    },
  );
}

test("FFprobe Linux runtime is a required production dependency", async () => {
  const manifest = JSON.parse(
    await readFile(join(project, "package.json"), "utf8"),
  );
  const lock = JSON.parse(
    await readFile(join(project, "package-lock.json"), "utf8"),
  );
  const name = "@ffprobe-installer/linux-x64";
  assert.equal(manifest.dependencies[name], "5.2.0");
  assert.equal(manifest.optionalDependencies?.[name], undefined);
  assert.equal(
    lock.packages[""].dependencies[name],
    manifest.dependencies[name],
  );
  assert.notEqual(lock.packages[linux].optional, true);
  assert.notEqual(lock.packages[linux].dev, true);
});

test(
  "production upload route imports and runs FFprobe with only traced files",
  { skip: !supported },
  async (t) => {
    const root = await tracedBundle(t);
    await copyFile(
      join(project, "tests/fixtures/technical-test-15s.mp4"),
      join(root, "test.mp4"),
    );
    await inBundle(
      root,
      `
    const assert = require('node:assert/strict');
    const { execFileSync } = require('node:child_process');
    const compiled = await require('./${route}');
    assert.equal(typeof compiled.routeModule.userland.POST, 'function');
    const ffprobe = require('@ffprobe-installer/ffprobe');
    assert.equal(ffprobe.path, require.resolve('@ffprobe-installer/linux-x64/ffprobe'));
    assert.ok(require.resolve('@ffprobe-installer/linux-x64/package.json').startsWith(process.cwd()));
    const version = execFileSync(ffprobe.path, ['-version'], { encoding: 'utf8' });
    assert.match(version, /ffprobe version/);
    const metadata = JSON.parse(execFileSync(ffprobe.path,
      ['-protocol_whitelist', 'file,pipe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', 'test.mp4'],
      { encoding: 'utf8', timeout: 10000 }));
    assert.equal(metadata.streams.find(s => s.codec_type === 'video').codec_name, 'h264');
    assert.equal(metadata.streams.find(s => s.codec_type === 'video').width, 1920);
    assert.equal(metadata.streams.find(s => s.codec_type === 'audio').codec_name, 'aac');
    assert.ok(Math.abs(Number(metadata.format.duration) - 15) < 0.1);
  `,
    );
  },
);

test(
  "missing FFprobe runtime metadata does not crash upload route import",
  { skip: !supported },
  async (t) => {
    const root = await tracedBundle(t);
    await rm(join(root, linux, "package.json"));
    await inBundle(
      root,
      `
    const assert = require('node:assert/strict');
    const compiled = await require('./${route}');
    assert.equal(typeof compiled.routeModule.userland.POST, 'function');
    assert.throws(() => require('@ffprobe-installer/ffprobe'),
      error => error.code === 'MODULE_NOT_FOUND' && error.message.includes('linux-x64/package.json'));
  `,
    );
  },
);
