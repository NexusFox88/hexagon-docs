/** Staged cloud tutorial. Run one command at a time from the repository root. */
import { mkdir, open, readFile, writeFile, rename, unlink, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Hexagon } from '../../sdk/typescript/dist/index.js';

const command = process.argv[2];
if (!['start', 'observe', 'preview', 'followup', 'close'].includes(command)) {
  throw new Error('Choose start, observe, preview, followup, or close');
}
const folder = '.local/docs-project-typescript';
await mkdir(folder, { recursive: true, mode: 0o700 });
const journal = `${folder}/journal.json`;
const fixture = fileURLToPath(new URL('./filter-app/', import.meta.url));
const prompts = JSON.parse(await readFile(new URL('./project-task-prompts.json', import.meta.url), 'utf8'));
const expected = ['filter.mjs', 'app.mjs', 'index.html', 'style.css', 'acceptance.mjs', 'test-report.txt'];
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
type SavedArtifact = { id: string; name: string; local_file: string; download_sha256: string };
type SavedRun = { input: string; key: string; id?: string; state?: string; exports_checked?: boolean; artifacts?: SavedArtifact[] };
type Journal = { phase: string; runs: Record<string, SavedRun>; input_sha256: Record<string, string>;
  session?: string; current?: string; preview_intent?: boolean; preview?: unknown };
let record: Journal;
async function save() {
  await writeFile(`${journal}.tmp`, JSON.stringify(record, null, 2), { mode: 0o600 });
  await rename(`${journal}.tmp`, journal);
}
// A crash leaves this lock. Confirm the process has stopped before removing it.
const lock = await open(`${folder}/process.lock`, 'wx', 0o600);
try {
  await lock.writeFile(String(process.pid));
  const client = await Hexagon.local();
  async function submit(which: string) {
    const item = record.runs[which] ??= { input: prompts[which], key: randomUUID() };
    record.phase = `submitting_${which}`;
    await save();
    const run = await client.submit(record.session!, item.input, item.key);
    item.id = run.id;
    record.current = which; record.phase = `observing_${which}`;
    await save();
    console.log('Session:', record.session, 'Run:', run.id);
  }
  if (command === 'start') {
    const sandbox = process.env.HEXAGON_EXAMPLE_SANDBOX_ID;
    const model = process.env.HEXAGON_EXAMPLE_MODEL_ID;
    if (!sandbox || !model) throw new Error('Set both example connection IDs');
    const files = [];
    const digests: Record<string, string> = {};
    for (const entry of (await readdir(fixture, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile()) continue;
      const data = await readFile(`${fixture}/${entry.name}`);
      files.push({ path: entry.name, content_base64: data.toString('base64') });
      digests[entry.name] = hash(data);
    }
    record = { phase: 'creating_session', runs: {}, input_sha256: digests };
    const initial = await open(journal, 'wx', 0o600);
    try { await initial.writeFile(JSON.stringify(record, null, 2)); } finally { await initial.close(); }
    const session = await client.createSession({ harness: { id: 'pi', version: '1.5.2' },
      sandbox_connection_id: sandbox, model_connection_id: model });
    record.session = session.id; record.phase = 'uploading'; await save();
    await client.upload(session.id, files);
    await submit('first');
  } else {
    record = JSON.parse(await readFile(journal, 'utf8'));
    if (command === 'observe') {
      const item = record.runs[record.current!];
      const deadline = Date.now() + 600_000;
      let result = await client.run(item.id!);
      while (!['completed', 'failed', 'cancelled'].includes(result.state)) {
        if (Date.now() >= deadline) throw new Error('Observation stopped; server execution may continue. Run observe again.');
        await new Promise(resolve => setTimeout(resolve, 2000));
        result = await client.run(item.id!);
      }
      item.state = result.state; await save();
      await writeFile(`${folder}/${record.current}-result.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
      if (result.state !== 'completed') throw new Error('Inspect this Run before continuing; close after investigation.');
      const { artifacts } = await client.artifacts(item.id!);
      const downloaded: SavedArtifact[] = [];
      for (const [index, artifact] of artifacts.entries()) {
        const data = await client.downloadArtifact(artifact.id);
        if (data.length !== artifact.size || hash(data) !== artifact.sha256)
          throw new Error('Artifact integrity mismatch');
        // Never execute downloaded model code or use its path as a local destination.
        const filename = `${record.current}-artifact-${index}.bin`;
        await writeFile(`${folder}/${filename}`, data, { mode: 0o600 });
        downloaded.push({ ...artifact, local_file: filename, download_sha256: hash(data) });
      }
      item.artifacts = downloaded; await save();
      const names = new Map(downloaded.map(a => [a.name, a]));
      if (!expected.every(name => names.has(name))) throw new Error('Missing required exports; inspect artifacts and result.');
      if (names.get('acceptance.mjs')!.download_sha256 !== record.input_sha256['acceptance.mjs']) {
        throw new Error('The fixed test changed; do not accept this result.');
      }
      item.exports_checked = true; record.phase = `review_${record.current}`; await save();
      console.log('Downloaded exports. Review test-report.txt, result, execution events and browser behavior before continuing.');
    } else if (command === 'followup') {
      if (record.runs.first.state !== 'completed' || !record.runs.first.exports_checked) {
        throw new Error('Observe and review the first Run before continuing.');
      }
      await submit('followup');
    } else if (command === 'preview') {
      if (record.preview_intent) throw new Error('Preview request already recorded. Inspect the saved grant or Console before creating another.');
      record.preview_intent = true; await save();
      record.preview = await client.createPreview(record.session!, 3000, 600); await save();
      console.log('Private preview URL saved in journal.json; open it locally. Do not share the ticket.');
    } else if (command === 'close') {
      record.phase = 'closing'; await save();
      const closed = await client.close(record.session!);
      if (closed.state !== 'closed') throw new Error('Cleanup not confirmed; inspect the same Session and resource operations.');
      for (const item of Object.values(record.runs)) {
        for (const artifact of item.artifacts ?? []) {
          if (hash(await client.downloadArtifact(artifact.id)) !== artifact.download_sha256) {
            throw new Error('Post-close artifact content differs.');
          }
        }
      }
      record.phase = 'closed_and_downloads_checked'; await save();
      console.log('Session closed; previously downloaded artifacts remain unchanged. This is not browser/test acceptance.');
    }
  }
} finally {
  await lock.close();
  await unlink(`${folder}/process.lock`);
}
