"""Application-owned SQLite intents around an existing Hexagon Session.

CLI user IDs are demonstration inputs, not authentication. A real HTTP handler
must obtain the principal from its authenticated session, never request JSON.
Use a private directory for the database: inputs may contain sensitive content.
"""
import argparse
import hashlib
import json
import sqlite3
import uuid
from pathlib import Path


class IntentStore:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS contexts (
            session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS intents (
            request_id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
            input TEXT NOT NULL, origin TEXT NOT NULL, key TEXT NOT NULL,
            run_id TEXT, UNIQUE(session_id,key));
          CREATE TABLE IF NOT EXISTS cleanup (
            session_id TEXT PRIMARY KEY, state TEXT NOT NULL,
            observed_state TEXT, last_error TEXT);
        ''')

    def bind(self, user, session):
        # This method belongs in the trusted Session-creation response handler.
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO contexts VALUES (?,?)', (session, user))
            self._owner(user, session)

    def _owner(self, user, session):
        row = self.db.execute('SELECT user_id FROM contexts WHERE session_id=?', (session,)).fetchone()
        if row is None or row['user_id'] != user:
            raise PermissionError('Context unavailable to this user')

    def prepare(self, user, request, session, text):
        if not text.strip():
            raise ValueError('Input must not be empty')
        with self.db:
            self._owner(user, session)
            self._accepting_work(session)
            prior = self.db.execute('SELECT * FROM intents WHERE request_id=?', (request,)).fetchone()
            if prior:
                self._owner(user, prior['session_id'])
                if prior['session_id'] != session or prior['input'] != text:
                    raise ValueError('Business request already has a different intent')
                return
            self.db.execute('INSERT INTO intents VALUES (?,?,?,?,?,NULL)',
                            (request, session, text, json.dumps({'request_id': request}), str(uuid.uuid4())))
        # Intent is committed before any SDK request.

    def get(self, user, request):
        row = self.db.execute('SELECT * FROM intents WHERE request_id=?', (request,)).fetchone()
        if row is None:
            raise LookupError('Request unavailable')
        self._owner(user, row['session_id'])
        return row

    def submit(self, client, user, request):
        row = self.get(user, request)
        if row['run_id']:
            return self._known_run(client, row)
        self._accepting_work(row['session_id'])
        result = client.submit(row['session_id'], row['input'], row['key'],
                               origin=json.loads(row['origin']))
        if result['session_id'] != row['session_id']:
            raise ValueError('Unexpected Run association')
        with self.db:
            current = self.get(user, request)
            if current['run_id'] and current['run_id'] != result['id']:
                raise ValueError('Conflicting Run identity')
            self.db.execute('UPDATE intents SET run_id=? WHERE request_id=?', (result['id'], request))
        return result

    def status(self, client, user, request):
        row = self.get(user, request)
        if not row['run_id']:
            return {'state': 'submission_not_confirmed', 'request_id': request}
        return self._known_run(client, row)

    def _known_run(self, client, row):
        result = client.run(row['run_id'])
        if result['id'] != row['run_id'] or result['session_id'] != row['session_id']:
            raise ValueError('Unexpected Run association')
        return result

    def deliver_artifact(self, client, user, request, artifact_id):
        """Return verified bytes only after business and resource ownership checks.

        The caller authenticates user, chooses an attachment response and checks
        its business success criteria. A terminal failed Run may have useful files.
        """
        row = self.get(user, request)
        if not row['run_id']:
            raise ValueError('Submission not confirmed')
        run = self._known_run(client, row)
        if run['state'] not in ('completed', 'failed', 'cancelled'):
            raise ValueError('Result not settled')
        entries = client.artifacts(row['run_id'])['artifacts']
        matches = [entry for entry in entries if entry['id'] == artifact_id]
        if len(matches) != 1:
            raise LookupError('Artifact unavailable for this request')
        item = matches[0]
        if item['run_id'] != row['run_id'] or item['session_id'] != row['session_id']:
            raise ValueError('Unexpected artifact association')
        content = client.download_artifact(item['id'])
        if len(content) != item['size'] or hashlib.sha256(content).hexdigest() != item['sha256']:
            raise ValueError('Artifact integrity check failed')
        # No user-controlled name is used as a filesystem path.
        return content

    def _accepting_work(self, session):
        if self.db.execute('SELECT 1 FROM cleanup WHERE session_id=?', (session,)).fetchone():
            raise ValueError('Context scheduled for closure')

    def request_cleanup(self, user, session):
        # Commit before contacting Hexagon; keep this record after confirmation.
        with self.db:
            self._owner(user, session)
            self.db.execute("INSERT OR IGNORE INTO cleanup VALUES (?,'requested',NULL,NULL)",
                            (session,))

    def cleanup_status(self, user, session):
        self._owner(user, session)
        row = self.db.execute('SELECT * FROM cleanup WHERE session_id=?', (session,)).fetchone()
        if row is None:
            raise LookupError('No cleanup intent')
        return dict(row)

    def cleanup_step(self, client, user, session):
        self.cleanup_status(user, session)
        try:
            remote = client.session(session)
            if remote['id'] != session:
                raise ValueError('Unexpected Session association')
            if remote['state'] != 'closed':
                # One same-Session reconciliation request, never direct cloud deletion.
                # The control plane may reject active work or report an unknown outcome.
                client.close(session)
                remote = client.session(session)
                if remote['id'] != session:
                    raise ValueError('Unexpected Session association')
            with self.db:
                self.db.execute("UPDATE cleanup SET state=?,observed_state=?,last_error=NULL WHERE session_id=?",
                                ('confirmed' if remote['state'] == 'closed' else 'requested',
                                 remote['state'], session))
        except Exception as error:
            # Do not persist exception text: upstream messages can contain private data.
            with self.db:
                self.db.execute('UPDATE cleanup SET last_error=? WHERE session_id=?',
                                (type(error).__name__, session))
            raise
        return self.cleanup_status(user, session)

    def close(self):
        self.db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True)
    parser.add_argument('--user', required=True)
    commands = parser.add_subparsers(dest='command', required=True)
    bind = commands.add_parser('bind')
    bind.add_argument('--session', required=True)
    prepare = commands.add_parser('prepare')
    prepare.add_argument('--session', required=True)
    prepare.add_argument('--request', required=True)
    prepare.add_argument('--input-file', required=True)
    for name in ['submit', 'status']:
        commands.add_parser(name).add_argument('--request', required=True)
    for name in ['request-cleanup', 'cleanup-status', 'cleanup-step']:
        commands.add_parser(name).add_argument('--session', required=True)
    args = parser.parse_args()
    store = IntentStore(args.database)
    try:
        if args.command == 'bind':
            store.bind(args.user, args.session)
        elif args.command == 'prepare':
            store.prepare(args.user, args.request, args.session, Path(args.input_file).read_text())
        elif args.command in ('request-cleanup', 'cleanup-status'):
            result = getattr(store, args.command.replace('-', '_'))(args.user, args.session)
            if result is not None:
                print(json.dumps(result))
        elif args.command == 'cleanup-step':
            from hexagon import Hexagon
            print(json.dumps(store.cleanup_step(Hexagon.local(), args.user, args.session)))
        else:
            from hexagon import Hexagon
            result = getattr(store, args.command)(Hexagon.local(), args.user, args.request)
            print(json.dumps({'id': result.get('id'), 'state': result.get('state'),
                              'error_code': (result.get('error') or {}).get('code')}))
    finally:
        store.close()


if __name__ == '__main__':
    main()
