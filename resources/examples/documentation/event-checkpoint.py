"""SQLite event checkpoint example. Run directly for an offline restart demo.

Import EventStore into a trusted backend consumer; do not expose it as a public
API. Use one ordered consumer per Run. Keep its database in private storage.
"""
import json
import re
import sqlite3
import tempfile
from pathlib import Path


class EventStore:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS events (
            run_id TEXT NOT NULL, event_id TEXT NOT NULL, payload TEXT NOT NULL,
            PRIMARY KEY (run_id,event_id));
          CREATE TABLE IF NOT EXISTS cursors (
            run_id TEXT PRIMARY KEY, event_id TEXT NOT NULL);
        ''')

    def cursor(self, run_id):
        row = self.db.execute('SELECT event_id FROM cursors WHERE run_id=?', (run_id,)).fetchone()
        return row[0] if row else '0'

    def commit(self, run_id, event):
        event_id = event.get('id')
        if event_id is None:
            return False  # stream.end is transport state, not a checkpoint.
        if not isinstance(event_id, str) or not re.fullmatch(r'[1-9][0-9]*', event_id):
            raise ValueError('Expected a positive decimal event ID string')
        payload = json.dumps(event, ensure_ascii=False, sort_keys=True)
        try:
            self.db.execute('BEGIN IMMEDIATE')
            prior = self.db.execute('SELECT payload FROM events WHERE run_id=? AND event_id=?',
                                    (run_id, event_id)).fetchone()
            if prior:
                if prior[0] != payload:
                    raise ValueError('Conflicting content for an existing event ID')
                self.db.commit()
                return False
            if int(event_id) <= int(self.cursor(run_id)):
                raise ValueError('Unseen event behind cursor; inspect consumer ordering')
            self.db.execute('INSERT INTO events VALUES (?,?,?)', (run_id, event_id, payload))
            self.db.execute('INSERT INTO cursors VALUES (?,?) ON CONFLICT(run_id) '
                            'DO UPDATE SET event_id=excluded.event_id', (run_id, event_id))
            self.db.commit()
            return True
        except BaseException:
            self.db.rollback()
            raise

    def close(self):
        self.db.close()


def demo():
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / 'events.sqlite'
        first = {'id': '9007199254740993', 'type': 'run.state', 'data': {'state': 'running'}}
        second = {'id': '9007199254741001', 'type': 'run.state', 'data': {'state': 'completed'}}
        store = EventStore(path)
        assert store.commit('run-demo', first)
        store.close()  # Simulate restart after commit, before browser delivery.
        store = EventStore(path)
        assert store.cursor('run-demo') == first['id']
        assert not store.commit('run-demo', first)
        assert store.commit('run-demo', second)
        assert not store.commit('run-demo', first)
        assert not store.commit('run-demo', {'type': 'stream.end', 'data': {'state': 'completed'}})
        assert store.cursor('run-demo') == second['id']
        try:
            store.commit('run-demo', {**second, 'data': {'state': 'failed'}})
        except ValueError:
            pass
        else:
            raise AssertionError('Conflicting replay was accepted')
        assert store.db.execute('SELECT count(*) FROM events').fetchone()[0] == 2
        assert store.cursor('another-run') == '0'
        store.db.execute("CREATE TRIGGER fail_checkpoint BEFORE INSERT ON cursors "
                         "WHEN NEW.run_id='rollback-demo' BEGIN "
                         "SELECT RAISE(ABORT, 'simulated cursor write failure'); END")
        try:
            store.commit('rollback-demo', first)
        except sqlite3.IntegrityError:
            pass
        else:
            raise AssertionError('Injected failure did not interrupt the transaction')
        assert store.cursor('rollback-demo') == '0'
        assert store.db.execute('SELECT count(*) FROM events WHERE run_id=?',
                                ('rollback-demo',)).fetchone()[0] == 0
        store.close()
    print('Offline SQLite demo passed: restart, replay, large IDs, gaps, transport event, conflict, Run isolation, transaction rollback.')


if __name__ == '__main__':
    demo()
