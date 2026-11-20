"""Read an existing Run; no submission/cancellation/approval/resource mutations."""
import argparse
import json
from hexagon import Hexagon


def inspect(client, session_id, run_id, after='0', max_pages=20):
    run = client.run(run_id)
    if run['session_id'] != session_id:
        raise ValueError('Run does not belong to the supplied Session')
    session = client.session(session_id)
    counts = {}
    cursor = after
    drained = False
    for _ in range(max_pages):
        events = client.events(run_id, cursor)['events']
        if not events:
            drained = True
            break
        for event in events:
            value = event.get('id')
            if not isinstance(value, str) or not value.isascii() or not value.isdigit() or int(value) <= int(cursor):
                raise ValueError('Expected strictly increasing decimal-string event IDs')
            counts[event['type']] = counts.get(event['type'], 0) + 1
            cursor = value
    latest = client.run(run_id)
    artifacts = client.artifacts(run_id)['artifacts']
    return {
        'session_id': session_id, 'run_id': run_id,
        'session_state': session['state'], 'run_state': latest['state'],
        'error_code': (latest.get('error') or {}).get('code'),
        'after': after, 'last_observed_cursor': cursor,
        'reached_empty_event_page': drained,
        'event_type_counts': counts,
        'artifacts': [{'id': a['id'], 'size': a['size'], 'sha256': a['sha256']} for a in artifacts],
        'scope': 'Bounded observation, not an atomic snapshot or persisted event consumer checkpoint',
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--session', required=True)
    parser.add_argument('--run', required=True)
    parser.add_argument('--after', default='0')
    parser.add_argument('--max-pages', type=int, default=20)
    args = parser.parse_args()
    if not args.after.isascii() or not args.after.isdigit() or not 1 <= args.max_pages <= 1000:
        parser.error('after must be decimal digits; max-pages must be 1–1000')
    print(json.dumps(inspect(Hexagon.local(), args.session, args.run, args.after, args.max_pages), indent=2))
