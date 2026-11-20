/** Run from the repository root; creates billable cloud resources. */
import { mkdir, open, writeFile, rename } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { Hexagon } from '../../sdk/typescript/dist/index.js';

const sandbox = process.env.HEXAGON_EXAMPLE_SANDBOX_ID;
const model = process.env.HEXAGON_EXAMPLE_MODEL_ID;
if (!sandbox || !model) throw new Error('Set both example connection IDs');
const folder = '.local/docs-first-typescript';
await mkdir(folder, { recursive: true, mode: 0o700 });
const journal = `${folder}/journal.json`;
const record: { input: string; key: string; phase: string; session?: string; run?: string; connections: {sandbox: string; model: string}; artifacts?: unknown[] } = {
  input: 'Create hello.txt in your supplied Run artifact directory containing exactly Hello from Hexagon followed by a newline. Then explain what you created.',
  key: randomUUID(), phase: 'before_session_creation',
  connections: {sandbox, model},
};
const initial = await open(journal, 'wx', 0o600);
try { await initial.writeFile(JSON.stringify(record)); } finally { await initial.close(); }
async function save() {
  await writeFile(`${journal}.tmp`, JSON.stringify(record), { mode: 0o600 });
  await rename(`${journal}.tmp`, journal);
}
const client = await Hexagon.local();
try {
  const session = await client.createSession({
    harness: { id: 'pi', version: '1.5.2' },
    sandbox_connection_id: sandbox, model_connection_id: model,
  });
  record.session = session.id; record.phase = 'before_run_submission'; await save();
  const run = await client.submit(session.id, record.input, record.key);
  record.run = run.id; record.phase = 'observing'; await save();
  console.log('Session:', session.id, 'Run:', run.id);
  const deadline = Date.now() + 600_000;
  let result = await client.run(run.id);
  while (!['completed', 'failed', 'cancelled'].includes(result.state)) {
    if (Date.now() >= deadline) throw new Error('Observation deadline reached; the Run may still be active');
    await new Promise(resolve => setTimeout(resolve, 2000));
    result = await client.run(run.id);
  }
  if (result.state !== 'completed') throw new Error('Run did not complete successfully; inspect Console');
  console.log(result.output);
  const { artifacts } = await client.artifacts(run.id);
  if (!artifacts.length) throw new Error('Expected an exported artifact');
  let matched = false;
  let firstBytes: Uint8Array | undefined;
  for (const [index, artifact] of artifacts.entries()) {
    const bytes = await client.downloadArtifact(artifact.id);
    if (bytes.length !== artifact.size || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256)
      throw new Error('Artifact integrity mismatch');
    if (index === 0) firstBytes = bytes;
    await writeFile(`${folder}/artifact-${index}.bin`, bytes);
    matched ||= Buffer.from(bytes).toString('utf8').trim() === 'Hello from Hexagon';
  }
  if (!matched) throw new Error('Artifact content did not match the task');
  record.artifacts = artifacts;
  record.phase = 'closing'; await save();
  const closed = await client.close(session.id);
  if (closed.state !== 'closed') throw new Error('Cleanup not confirmed; inspect the same Session');
  const retained = await client.downloadArtifact(artifacts[0].id);
  if (!firstBytes || !Buffer.from(retained).equals(Buffer.from(firstBytes)))
    throw new Error('Retained artifact differs after closure');
  record.phase = 'closed_and_retention_checked'; await save();
  console.log('Completed; artifacts and journal:', folder);
} catch (error) {
  console.error('Keep the private journal and inspect the recorded Session/Run. Do not rerun with a new key.');
  throw error;
}
