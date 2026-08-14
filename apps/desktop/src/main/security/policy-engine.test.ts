import assert from 'node:assert/strict';
import test from 'node:test';
import { PolicyEngine } from './policy-engine';

const policy = new PolicyEngine();

test('allows a known read-only PowerShell command', () => {
  assert.equal(
    policy.evaluateCommand({ shell: 'powershell', script: 'Get-ChildItem' }).decision,
    'allow',
  );
});

test('requires approval for an unknown command', () => {
  assert.equal(
    policy.evaluateCommand({ shell: 'powershell', script: 'dotnet test' }).decision,
    'ask',
  );
});

test('requires approval for file writes', () => {
  assert.equal(
    policy.evaluateCommand({ shell: 'powershell', script: 'Set-Content output.txt ok' }).decision,
    'ask',
  );
});

test('denies destructive recursive deletion', () => {
  assert.equal(
    policy.evaluateCommand({
      shell: 'powershell',
      script: 'Remove-Item C:\\important -Recurse -Force',
    }).decision,
    'deny',
  );
});

test('applies the same guard baseline to macOS file commands', () => {
  const engine = new PolicyEngine();
  assert.equal(engine.evaluateCommand({ shell: 'zsh', script: 'rm -rf ./build' }).decision, 'deny');
  assert.equal(engine.evaluateCommand({ shell: 'zsh', script: 'mkdir output' }).decision, 'ask');
  assert.equal(engine.evaluateCommand({ shell: 'zsh', script: 'pwd' }).decision, 'allow');
});
