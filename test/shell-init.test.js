// Tests for bin/shell-init.js — the installer hook that writes the `claudia`
// shell function and wires it into the user's shell rc files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  writeShellInit,
  appendShellRC,
  SHELL_INIT_CONTENT,
  SHELL_INIT_MARKER,
} from '../bin/shell-init.js';

function makeHome() {
  return mkdtempSync(join(tmpdir(), 'claudia-shell-init-'));
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

test('writeShellInit writes claudia-home pointing at install dir', () => {
  const home = makeHome();
  try {
    const targetDir = '/some/where/claudia';
    const { homeFile, initFile } = writeShellInit(home, targetDir);

    assert.equal(homeFile, join(home, '.claudia', 'claudia-home'));
    assert.equal(initFile, join(home, '.claudia', 'shell-init.sh'));

    const homeContent = readFileSync(homeFile, 'utf8');
    assert.equal(homeContent.trim(), targetDir);
  } finally {
    cleanup(home);
  }
});

test('writeShellInit writes the shell function content', () => {
  const home = makeHome();
  try {
    const { initFile } = writeShellInit(home, '/x/y');
    const content = readFileSync(initFile, 'utf8');
    assert.equal(content, SHELL_INIT_CONTENT);
    // Spot-check the function structure
    assert.ok(content.includes('claudia()'));
    assert.ok(content.includes('yolo'));
    assert.ok(content.includes('--dangerously-skip-permissions'));
    assert.ok(content.includes('command claudia'));
    // Update surface area
    assert.ok(content.includes('update-claudia()'));
    assert.ok(content.includes('npx get-claudia'));
    assert.ok(content.includes('update)'), 'claudia() must route the `update` subcommand');
  } finally {
    cleanup(home);
  }
});

test('writeShellInit creates ~/.claudia if it does not exist', () => {
  const home = makeHome();
  try {
    // Don't pre-create the dir
    assert.equal(existsSync(join(home, '.claudia')), false);
    writeShellInit(home, '/x');
    assert.equal(existsSync(join(home, '.claudia')), true);
  } finally {
    cleanup(home);
  }
});

test('appendShellRC adds source line to .zshrc and .bashrc when absent', () => {
  const home = makeHome();
  try {
    writeFileSync(join(home, '.zshrc'), '# existing zsh config\nexport FOO=bar\n');
    writeFileSync(join(home, '.bashrc'), '# existing bash config\n');

    const result = appendShellRC(home, 'darwin');

    assert.equal(result.added.length, 2);
    assert.equal(result.unchanged.length, 0);

    const zshrc = readFileSync(join(home, '.zshrc'), 'utf8');
    const bashrc = readFileSync(join(home, '.bashrc'), 'utf8');

    assert.ok(zshrc.includes(SHELL_INIT_MARKER));
    assert.ok(zshrc.includes('source "$HOME/.claudia/shell-init.sh"'));
    assert.ok(zshrc.includes('export FOO=bar')); // existing content preserved
    assert.ok(bashrc.includes(SHELL_INIT_MARKER));
  } finally {
    cleanup(home);
  }
});

test('appendShellRC is idempotent: second run is a no-op', () => {
  const home = makeHome();
  try {
    writeFileSync(join(home, '.zshrc'), '');
    writeFileSync(join(home, '.bashrc'), '');

    const first = appendShellRC(home, 'darwin');
    assert.equal(first.added.length, 2);

    const second = appendShellRC(home, 'darwin');
    assert.equal(second.added.length, 0);
    assert.equal(second.unchanged.length, 2);

    // Verify the marker appears exactly once in each file
    const zshrc = readFileSync(join(home, '.zshrc'), 'utf8');
    const occurrences = zshrc.split(SHELL_INIT_MARKER).length - 1;
    assert.equal(occurrences, 1, '.zshrc must contain marker exactly once');
  } finally {
    cleanup(home);
  }
});

test('appendShellRC creates rc files if missing', () => {
  const home = makeHome();
  try {
    // No rc files exist
    assert.equal(existsSync(join(home, '.zshrc')), false);
    assert.equal(existsSync(join(home, '.bashrc')), false);

    const result = appendShellRC(home, 'linux');

    assert.equal(result.added.length, 2);
    assert.equal(existsSync(join(home, '.zshrc')), true);
    assert.equal(existsSync(join(home, '.bashrc')), true);
  } finally {
    cleanup(home);
  }
});

test('appendShellRC handles rc files without trailing newline', () => {
  const home = makeHome();
  try {
    // File ends without newline — the snippet should still be cleanly separated
    writeFileSync(join(home, '.zshrc'), 'export PATH="/usr/local/bin:$PATH"');
    writeFileSync(join(home, '.bashrc'), 'alias ll="ls -la"');

    appendShellRC(home, 'darwin');

    const zshrc = readFileSync(join(home, '.zshrc'), 'utf8');
    // The original line must remain on its own line, not concatenated with the marker
    assert.ok(zshrc.includes('/usr/local/bin:$PATH"\n'));
    assert.ok(zshrc.includes(SHELL_INIT_MARKER));
  } finally {
    cleanup(home);
  }
});

test('appendShellRC skips on Windows', () => {
  const home = makeHome();
  try {
    const result = appendShellRC(home, 'win32');
    assert.equal(result.skipped, true);
    assert.equal(result.added.length, 0);
    assert.equal(existsSync(join(home, '.zshrc')), false);
    assert.equal(existsSync(join(home, '.bashrc')), false);
  } finally {
    cleanup(home);
  }
});
