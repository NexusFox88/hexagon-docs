/** A/B/C rollout. Run once from repository root; creates cloud resources. */
import { mkdir, open, writeFile, rename } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { Hexagon, HexagonError, type AgentInput, type Artifact, type SessionInitialization } from '../../sdk/typescript/dist/index.js';
const sandbox = process.env.HEXAGON_EXAMPLE_SANDBOX_ID;
const model = process.env.HEXAGON_EXAMPLE_MODEL_ID;
if (!sandbox || !model) throw new Error('Set both example connection IDs');
const bindings = { sandbox_connection_id: sandbox, model_connection_id: model };
const folder = '.local/docs-revisions-typescript';
await mkdir(folder, { recursive: true, mode: 0o700 });
const journal = `${folder}/journal.json`;
type Entry = { id: string; revision: number; input?: string; key?: string; run_id?: string; proof?: Artifact };
const record: { phase: string; bindings: typeof bindings; sessions: Record<string, Entry>; agent_id?: string;
  original_revision?: number; updated_revision?: number; definition?: AgentInput;
  revision_intent?: {definition: AgentInput; expected_revision: number};
  snapshots?: Record<string, SessionInitialization>; archive?: unknown; unexpected_sessions?: string[];
} = { phase: 'before_agent_creation', bindings, sessions: {} };
const initial = await open(journal, 'wx', 0o600);
try { await initial.writeFile(JSON.stringify(record)); } finally { await initial.close(); }
async function save() {
  await writeFile(`${journal}.tmp`, JSON.stringify(record, null, 2), { mode: 0o600 });
  await rename(`${journal}.tmp`, journal);
}
function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const client = await Hexagon.local();
try {
  const definition: AgentInput = { name: 'Documentation revision exercise',
    harness: { id: 'pi', version: '1.5.2' }, instructions: 'Report changed files',
    resources: { timeout_seconds: 180 } };
  record.definition = definition; await save();
  let agent = await client.createAgent(definition);
  record.agent_id = agent.id; record.original_revision = agent.revision; await save();
  for (const label of ['A', 'B', 'C']) {
    if (label === 'C') {
      const revised: AgentInput = structuredClone(agent.definition);
      revised.instructions = 'Report changed files and test results';
      revised.resources = { ...revised.resources, timeout_seconds: 300 };
      record.revision_intent = { definition: revised, expected_revision: agent.revision };
      record.phase = 'before_revision'; await save();
      agent = await client.reviseAgent(agent.id, revised, agent.revision);
      record.updated_revision = agent.revision; await save();
    }
    record.phase = `before_session_${label}`; await save();
    const session = await client.createSession({ agent_id: agent.id, agent_revision: agent.revision, ...bindings });
    const entry: Entry = { id: session.id, revision: agent.revision };
    record.sessions[label] = entry;
    const program = "from pathlib import Path\n" +
      `p=Path('.hexagon-revision-marker'); assert not p.exists(), 'unexpected prior marker'; p.write_text('${label}\\n')\n`;
    const prompt = `Execute this exact Python code in the project workspace:\n${program}` +
      `Then export proof.txt containing exactly ${label} followed by a newline into your supplied Run artifact directory. ` +
      'Export only after the assertion and write succeed. Report the executed check honestly.';
    entry.input = prompt; entry.key = randomUUID();
    record.phase = `before_run_${label}`; await save();
    const run = await client.submit(session.id, prompt, entry.key);
    entry.run_id = run.id; record.phase = `observing_${label}`; await save();
    const deadline = Date.now() + 600_000;
    let result = await client.run(run.id);
    while (!['completed', 'failed', 'cancelled'].includes(result.state)) {
      requireCondition(Date.now() < deadline, 'Observation timed out; original Run may still execute');
      await new Promise(resolve => setTimeout(resolve, 2000));
      result = await client.run(run.id);
    }
    requireCondition(result.state === 'completed', 'Run failed; inspect original records');
    const proof = (await client.artifacts(run.id)).artifacts.filter(a => a.name === 'proof.txt');
    requireCondition(proof.length === 1, 'Expected exactly one proof.txt');
    const artifact = proof[0], data = await client.downloadArtifact(artifact.id);
    requireCondition(Buffer.from(data).equals(Buffer.from(`${label}\n`)) && data.length === artifact.size &&
      createHash('sha256').update(data).digest('hex') === artifact.sha256, 'Incorrect proof bytes');
    entry.proof = artifact; await save();
  }
  const before: Record<string, SessionInitialization> = {};
  for (const [label, entry] of Object.entries(record.sessions)) {
    const snapshot = await client.sessionInitialization(entry.id); before[label] = snapshot;
    requireCondition(snapshot.source.agent_revision === entry.revision, 'Revision mismatch');
    requireCondition(snapshot.definition.instructions === (label === 'C' ? 'Report changed files and test results' : 'Report changed files'), 'Instructions changed unexpectedly');
    requireCondition(snapshot.definition.resources.timeout_seconds === (label === 'C' ? 300 : 180), 'Timeout changed unexpectedly');
  }
  record.snapshots = before; record.phase = 'before_archive'; await save();
  record.archive = await client.archiveAgent(agent.id); await save();
  for (const revision of [record.original_revision, record.updated_revision]) {
    let unexpected: {id:string} | undefined;
    try { unexpected = await client.createSession({ agent_id: agent.id, agent_revision: revision, ...bindings }); }
    catch (error) {
      requireCondition(error instanceof HexagonError && error.status === 409 && error.code === 'agent_archived', 'Unexpected archive error');
    }
    if (unexpected) {
      (record.unexpected_sessions ??= []).push(unexpected.id); await save();
      throw new Error('Archive allowed creation; inspect and close unexpected Session');
    }
  }
  for (const [label, entry] of Object.entries(record.sessions)) {
    requireCondition(JSON.stringify(await client.sessionInitialization(entry.id)) === JSON.stringify(before[label]), 'Archive changed historical snapshot');
    record.phase = `closing_${label}`; await save();
    requireCondition((await client.close(entry.id)).state === 'closed', 'Cleanup not confirmed');
    requireCondition(entry.proof, 'Missing proof metadata');
    requireCondition(Buffer.from(await client.downloadArtifact(entry.proof.id)).equals(Buffer.from(`${label}\n`)), 'Retention mismatch');
  }
  record.phase = 'closed_and_history_checked'; await save();
  console.log('Completed; inspect execution events to verify marker commands:', folder);
} catch (error) {
  console.error('Keep the journal. Inspect original Agent, Sessions, Runs and operations; do not restart blindly.');
  throw error;
}
