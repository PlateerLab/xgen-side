import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { AgentRunRequest } from '../../shared/contracts';
import { LocalRunStore } from './local-run-store';

const request: AgentRunRequest = {
  providerId: 'codex',
  model: 'gpt-5.6-sol',
  mode: 'chat',
  prompt: 'Analyze the attachment.',
  permissionMode: 'guard',
};

test('stages supported files, materializes read-only inputs, and collects separate artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xgen-run-store-'));
  try {
    const source = join(root, 'brief.docx');
    await writeFile(source, Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('[Content_Types].xml\0word/document.xml'),
    ]));
    const store = new LocalRunStore(join(root, 'data'));
    const [attachment] = await store.stageAttachments([source]);
    assert.equal(attachment?.kind, 'docx');

    const session = await store.createSession({ ...request, attachments: [attachment!] });
    const prepared = await store.materializeAttachments(session, [attachment!]);
    assert.equal(prepared[0]?.relativePath, 'attachments/brief.docx');
    assert.deepEqual(await readFile(join(session.workspace, 'attachments', 'brief.docx')), await readFile(source));
    await assert.rejects(access(join(store.status().root, 'attachments', 'inbox', attachment!.id)));

    await mkdir(join(session.workspace, 'artifacts'), { recursive: true });
    await writeFile(join(session.workspace, 'artifacts', 'brief-revised.docx'), Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('[Content_Types].xml\0word/document.xml'),
    ]));
    const artifacts = await store.collectArtifacts(session);
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0]?.name, 'brief-revised.docx');
    assert.equal(store.resolveArtifactPath(session.id, artifacts[0]!.relativePath), join(session.workspace, 'artifacts', 'brief-revised.docx'));
    assert.throws(() => store.resolveArtifactPath(session.id, 'artifacts/../../session.json'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects an attachment whose extension and signature disagree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xgen-run-store-'));
  try {
    const source = join(root, 'fake.pdf');
    const genericZip = join(root, 'fake.docx');
    await writeFile(source, 'not a pdf');
    await writeFile(genericZip, Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('archive/readme.txt'),
    ]));
    const store = new LocalRunStore(join(root, 'data'));
    await assert.rejects(store.stageAttachments([source]), /확장자와 실제 형식/);
    await assert.rejects(store.stageAttachments([genericZip]), /확장자와 실제 형식/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
