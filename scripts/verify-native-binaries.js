#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const defaultTargets = [
  path.join(repoRoot, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
];

const targets = process.argv.slice(2).map((p) => path.resolve(repoRoot, p));
const files = targets.length > 0 ? targets : defaultTargets;

let failures = 0;

for (const file of files) {
  try {
    verifyWindowsPeX64(file);
    console.log(`[native-verify] OK ${path.relative(repoRoot, file)}`);
  } catch (error) {
    failures += 1;
    console.error(
      `[native-verify] FAIL ${path.relative(repoRoot, file)}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

if (failures > 0) {
  process.exitCode = 1;
}

function verifyWindowsPeX64(file) {
  if (!fs.existsSync(file)) {
    throw new Error('file does not exist');
  }

  const header = Buffer.alloc(512);
  const fd = fs.openSync(file, 'r');
  const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
  fs.closeSync(fd);

  if (bytesRead < 64) {
    throw new Error('file is too small to be a native module');
  }

  if (header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46) {
    throw new Error('Linux ELF binary found in Windows build');
  }

  if (header[0] !== 0x4d || header[1] !== 0x5a) {
    throw new Error(
      `expected Windows MZ header, got ${header[0].toString(16).padStart(2, '0')} ${header[1]
        .toString(16)
        .padStart(2, '0')}`
    );
  }

  const peOffset = header.readUInt32LE(0x3c);
  const peHeader = Buffer.alloc(6);
  const peFd = fs.openSync(file, 'r');
  const peBytesRead = fs.readSync(peFd, peHeader, 0, peHeader.length, peOffset);
  fs.closeSync(peFd);

  if (peBytesRead < 6 || peHeader[0] !== 0x50 || peHeader[1] !== 0x45 || peHeader[2] !== 0 || peHeader[3] !== 0) {
    throw new Error('missing PE signature');
  }

  const machine = peHeader.readUInt16LE(4);
  if (machine !== 0x8664) {
    throw new Error(`expected Windows x64 machine 0x8664, got 0x${machine.toString(16)}`);
  }
}
