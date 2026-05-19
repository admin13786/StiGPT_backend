'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const scripts = ['seed.js'];

for (const script of scripts) {
  const fullPath = path.join(__dirname, script);
  const result = spawnSync(process.execPath, [fullPath], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
