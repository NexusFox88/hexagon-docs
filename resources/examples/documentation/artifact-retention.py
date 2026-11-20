"""Run from the repository root; creates billable cloud resources."""
import json
import hashlib
import os
from pathlib import Path
import time
import uuid
from hexagon import Hexagon

sandbox = os.environ['HEXAGON_EXAMPLE_SANDBOX_ID']
model = os.environ['HEXAGON_EXAMPLE_MODEL_ID']
folder = Path('.local/docs-artifacts-python')
folder.mkdir(parents=True, exist_ok=True, mode=0o700)
journal = folder / 'journal.json'
record = {
    'input': 'In your supplied Run artifact directory, create message.txt containing exactly Hello from Hexagon followed by one newline, and status.json containing exactly {"ok":true} followed by one newline. Do not put these files in a subdirectory. Then explain what you created.',
    'key': str(uuid.uuid4()),
    'phase': 'before_session_creation',
    'connections': {'sandbox': sandbox, 'model': model},
}
# Exclusive creation prevents an accidental second execution of this example.
with open(journal, 'x', opener=lambda path, flags: os.open(path, flags, 0o600)) as handle:
    json.dump(record, handle)

def save():
    temporary = folder / 'journal.tmp'
    with open(temporary, 'w', opener=lambda path, flags: os.open(path, flags, 0o600)) as handle:
        json.dump(record, handle)
    temporary.replace(journal)

client = Hexagon.local()
try:
    session = client.create_session(
        harness={'id': 'pi', 'version': '1.5.2'},
        sandbox_connection_id=sandbox, model_connection_id=model,
    )
    record.update(session=session['id'], phase='before_run_submission')
    save()
    run = client.submit(session['id'], record['input'], record['key'])
    record.update(run=run['id'], phase='observing')
    save()
    print('Session:', session['id'], 'Run:', run['id'], flush=True)
    deadline = time.monotonic() + 600
    while True:
        result = client.run(run['id'])
        if result['state'] in ('completed', 'failed', 'cancelled'):
            break
        if time.monotonic() >= deadline:
            raise TimeoutError('Observation deadline reached; the Run may still be active')
        time.sleep(2)
    if result['state'] != 'completed':
        raise RuntimeError('Run did not complete successfully; inspect Console')
    print(result['output'])
    artifacts = client.artifacts(run['id'])['artifacts']
    if not artifacts:
        raise RuntimeError('Expected an exported artifact')
    expected = {'message.txt': b'Hello from Hexagon\n', 'status.json': b'{"ok":true}\n'}
    contents = []
    matched = set()
    for index, artifact in enumerate(artifacts):
        data = client.download_artifact(artifact['id'])
        if len(data) != artifact['size'] or hashlib.sha256(data).hexdigest() != artifact['sha256']:
            raise RuntimeError('Artifact integrity mismatch')
        with open(folder / f'artifact-{index}.bin', 'xb',
                  opener=lambda path, flags: os.open(path, flags, 0o600)) as destination:
            destination.write(data)
        contents.append(data)
        if artifact['name'] in expected:
            if artifact['name'] in matched or data != expected[artifact['name']]:
                raise RuntimeError('Required artifact has duplicate name or incorrect bytes')
            matched.add(artifact['name'])
    if matched != set(expected):
        raise RuntimeError('Artifact content did not match the task')
    record['artifacts'] = artifacts
    record['phase'] = 'closing'
    save()
    closed = client.close(session['id'])
    if closed.get('state') != 'closed':
        raise RuntimeError('Cleanup not confirmed; inspect the same Session')
    # Retention is checked after cloud cleanup.
    for artifact, original in zip(artifacts, contents):
        retained = client.download_artifact(artifact['id'])
        if retained != original:
            raise RuntimeError('Retained artifact differs after closure')
    record['phase'] = 'closed_and_retention_checked'
    save()
    print('Completed; artifacts and journal:', folder)
except BaseException:
    print('Keep the private journal and inspect the recorded Session/Run. Do not rerun with a new key.', flush=True)
    raise
