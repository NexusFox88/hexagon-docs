"""A/B/C template rollout. Run once from the repository root; creates cloud resources."""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import time
import uuid
from hexagon import Hexagon, HexagonError

folder = Path('.local/docs-revisions-python')
folder.mkdir(parents=True, exist_ok=True, mode=0o700)
bindings = dict(sandbox_connection_id=os.environ['HEXAGON_EXAMPLE_SANDBOX_ID'],
                model_connection_id=os.environ['HEXAGON_EXAMPLE_MODEL_ID'])
record = {'phase': 'before_agent_creation', 'bindings': bindings, 'sessions': {}}
journal = folder / 'journal.json'
with open(journal, 'x', opener=lambda p, f: os.open(p, f, 0o600)) as handle:
    json.dump(record, handle)


def save():
    temporary = folder / 'journal.tmp'
    with open(temporary, 'w', opener=lambda p, f: os.open(p, f, 0o600)) as handle:
        json.dump(record, handle, indent=2)
    temporary.replace(journal)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


client = Hexagon.local()
try:
    definition = dict(name='Documentation revision exercise',
                      harness={'id': 'pi', 'version': '1.5.2'},
                      instructions='Report changed files',
                      resources={'timeout_seconds': 180})
    record['definition'] = definition
    save()
    agent = client.create_agent(**definition)
    record['agent_id'] = agent['id']
    record['original_revision'] = agent['revision']
    save()
    for label in ('A', 'B', 'C'):
        if label == 'C':
            revised_definition = deepcopy(agent['definition'])
            revised_definition['instructions'] = 'Report changed files and test results'
            revised_definition['resources']['timeout_seconds'] = 300
            record['revision_intent'] = {'definition': revised_definition,
                                         'expected_revision': agent['revision']}
            record['phase'] = 'before_revision'
            save()
            agent = client.revise_agent(agent['id'], revised_definition, agent['revision'])
            record['updated_revision'] = agent['revision']
            save()
        record['phase'] = f'before_session_{label}'
        save()
        session = client.create_session(agent_id=agent['id'], agent_revision=agent['revision'], **bindings)
        entry = {'id': session['id'], 'revision': agent['revision']}
        record['sessions'][label] = entry
        # This code actually checks isolation; do not accept the model's prose as evidence.
        program = ("from pathlib import Path\n"
                   f"p=Path('.hexagon-revision-marker'); assert not p.exists(), 'unexpected prior marker'; p.write_text('{label}\\n')\n")
        prompt = (f'Execute this exact Python code in the project workspace:\n{program}'
                  f'Then export proof.txt containing exactly {label} followed by a newline into your supplied Run artifact directory. '
                  'Export only after the assertion and write succeed. Report the executed check honestly.')
        entry.update(input=prompt, key=str(uuid.uuid4()))
        record['phase'] = f'before_run_{label}'
        save()
        run = client.submit(session['id'], prompt, entry['key'])
        entry['run_id'] = run['id']
        record['phase'] = f'observing_{label}'
        save()
        deadline = time.monotonic() + 600
        while True:
            result = client.run(run['id'])
            if result['state'] in ('completed', 'failed', 'cancelled'):
                break
            require(time.monotonic() < deadline, 'Observation timed out; original Run may still execute')
            time.sleep(2)
        require(result['state'] == 'completed', 'Run failed; inspect original records')
        artifacts = client.artifacts(run['id'])['artifacts']
        proof = [a for a in artifacts if a['name'] == 'proof.txt']
        require(len(proof) == 1, 'Expected exactly one proof.txt')
        a = proof[0]
        data = client.download_artifact(a['id'])
        require(data == f'{label}\n'.encode() and len(data) == a['size']
                and hashlib.sha256(data).hexdigest() == a['sha256'], 'Incorrect proof bytes')
        entry['proof'] = a
        save()
    before = {label: client.session_initialization(e['id']) for label, e in record['sessions'].items()}
    for label, snapshot in before.items():
        latest = label == 'C'
        require(snapshot['source']['agent_revision'] == record['sessions'][label]['revision'], 'Revision mismatch')
        require(snapshot['definition']['instructions'] == ('Report changed files and test results' if latest else 'Report changed files'), 'Instructions changed unexpectedly')
        require(snapshot['definition']['resources']['timeout_seconds'] == (300 if latest else 180), 'Timeout changed unexpectedly')
    record['snapshots'] = before
    record['phase'] = 'before_archive'
    save()
    record['archive'] = client.archive_agent(agent['id'])
    save()
    for revision in (record['original_revision'], record['updated_revision']):
        try:
            unexpected = client.create_session(agent_id=agent['id'], agent_revision=revision, **bindings)
        except HexagonError as error:
            require(error.status == 409 and error.code == 'agent_archived', 'Unexpected archive error')
        else:
            record.setdefault('unexpected_sessions', []).append(unexpected['id'])
            save()
            raise RuntimeError('Archive allowed creation; inspect and close unexpected Session')
    for label, entry in record['sessions'].items():
        require(client.session_initialization(entry['id']) == before[label], 'Archive changed historical snapshot')
        record['phase'] = f'closing_{label}'
        save()
        require(client.close(entry['id'])['state'] == 'closed', 'Cleanup not confirmed')
        require(client.download_artifact(entry['proof']['id']) == f'{label}\n'.encode(), 'Retention mismatch')
    record['phase'] = 'closed_and_history_checked'
    save()
    print('Completed; inspect execution events to verify marker commands:', folder)
except BaseException:
    print('Keep the journal. Inspect original Agent, Sessions, Runs and operations; do not restart blindly.', flush=True)
    raise
