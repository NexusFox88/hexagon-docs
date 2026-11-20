"""Staged cloud tutorial. Run one command at a time from the repository root."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import time
import uuid
from hexagon import Hexagon

parser = argparse.ArgumentParser()
parser.add_argument('command', choices=['start', 'observe', 'preview', 'followup', 'close'])
command = parser.parse_args().command
folder = Path('.local/docs-project-python')
folder.mkdir(parents=True, exist_ok=True, mode=0o700)
journal = folder / 'journal.json'
fixture = Path(__file__).parent / 'filter-app'
prompts = json.loads((Path(__file__).parent / 'project-task-prompts.json').read_text())
expected = ['filter.mjs', 'app.mjs', 'index.html', 'style.css', 'acceptance.mjs', 'test-report.txt']

def write_json(path, value, exclusive=False):
    with open(path, 'x' if exclusive else 'w', opener=lambda p, f: os.open(p, f, 0o600)) as out:
        json.dump(value, out, indent=2)

def save():
    write_json(folder / 'journal.tmp', record)
    (folder / 'journal.tmp').replace(journal)

def submit(which):
    # The input and key precede the network call, including a repeated followup command.
    item = record['runs'].setdefault(which, {'input': prompts[which], 'key': str(uuid.uuid4())})
    record['phase'] = 'submitting_' + which
    save()
    run = client.submit(record['session'], item['input'], item['key'])
    item['id'] = run['id']
    record.update(current=which, phase='observing_' + which)
    save()
    print('Session:', record['session'], 'Run:', run['id'])

# An unclean process exit leaves this lock. Confirm the process has stopped before removing it.
lock = folder / 'process.lock'
with open(lock, 'x') as out:
    out.write(str(os.getpid()))
try:
    client = Hexagon.local()
    if command == 'start':
        sandbox = os.environ['HEXAGON_EXAMPLE_SANDBOX_ID']
        model = os.environ['HEXAGON_EXAMPLE_MODEL_ID']
        record = {'phase': 'creating_session', 'runs': {}, 'input_sha256': {
            p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(fixture.iterdir()) if p.is_file()
        }}
        write_json(journal, record, exclusive=True)
        session = client.create_session(harness={'id': 'pi', 'version': '1.5.2'},
            sandbox_connection_id=sandbox, model_connection_id=model)
        record.update(session=session['id'], phase='uploading')
        save()
        client.upload(session['id'], {p.name: p.read_bytes() for p in sorted(fixture.iterdir()) if p.is_file()})
        submit('first')
    else:
        record = json.loads(journal.read_text())
        if command == 'observe':
            item = record['runs'][record['current']]
            deadline = time.monotonic() + 600
            while True:
                result = client.run(item['id'])
                if result['state'] in ('completed', 'failed', 'cancelled'):
                    break
                if time.monotonic() >= deadline:
                    raise TimeoutError('Observation stopped; server execution may continue. Run observe again.')
                time.sleep(2)
            item['state'] = result['state']
            save()
            write_json(folder / (record['current'] + '-result.json'), result)
            if result['state'] != 'completed':
                raise RuntimeError('Inspect this Run before continuing; close the Session after investigation.')
            artifacts = client.artifacts(item['id'])['artifacts']
            downloaded = []
            for index, artifact in enumerate(artifacts):
                data = client.download_artifact(artifact['id'])
                if len(data) != artifact['size'] or hashlib.sha256(data).hexdigest() != artifact['sha256']:
                    raise RuntimeError('Artifact integrity mismatch')
                # Never execute downloaded model code or use its path as a local destination.
                filename = record['current'] + '-artifact-' + str(index) + '.bin'
                (folder / filename).write_bytes(data)
                downloaded.append({**artifact, 'local_file': filename, 'download_sha256': hashlib.sha256(data).hexdigest()})
            item['artifacts'] = downloaded
            save()
            names = {a['name']: a for a in downloaded}
            if not all(name in names for name in expected):
                raise RuntimeError('Missing required exports; inspect artifacts and task result.')
            if names['acceptance.mjs']['download_sha256'] != record['input_sha256']['acceptance.mjs']:
                raise RuntimeError('The fixed test changed; do not accept this result.')
            item['exports_checked'] = True
            record['phase'] = 'review_' + record['current']
            save()
            print('Downloaded exports. Review test-report.txt, result, execution events and browser behavior before continuing.')
        elif command == 'followup':
            if record['runs']['first'].get('state') != 'completed' or not record['runs']['first'].get('exports_checked'):
                raise RuntimeError('Observe and review the first Run before continuing.')
            submit('followup')
        elif command == 'preview':
            if 'preview_intent' in record:
                raise RuntimeError('Preview request already recorded. Inspect the saved grant or Console; do not blindly create another.')
            record['preview_intent'] = True
            save()
            grant = client.create_preview(record['session'], port=3000, ttl_seconds=600)
            record['preview'] = grant
            save()
            print('Private preview URL saved in journal.json; open it locally. Do not share the ticket.')
        elif command == 'close':
            record['phase'] = 'closing'
            save()
            closed = client.close(record['session'])
            if closed.get('state') != 'closed':
                raise RuntimeError('Cleanup not confirmed; inspect the same Session and resource operations.')
            for item in record['runs'].values():
                for artifact in item.get('artifacts', []):
                    data = client.download_artifact(artifact['id'])
                    if hashlib.sha256(data).hexdigest() != artifact['download_sha256']:
                        raise RuntimeError('Post-close artifact content differs.')
            record['phase'] = 'closed_and_downloads_checked'
            save()
            print('Session closed; previously downloaded artifacts remain unchanged. This is not browser/test acceptance.')
finally:
    lock.unlink()
