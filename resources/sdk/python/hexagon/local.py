"""Discover a private, local control plane without exposing its token to the user."""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit


def local_identity(data_directory=None, base_url=None):
    configured = data_directory or os.environ.get('HEXAGON_DATA_DIR')
    if configured:
        descriptor_file = Path(configured).expanduser().resolve() / 'connection.json'
    else:
        descriptor_file = next((p / '.local/control-plane/connection.json' for p in [Path.cwd(), *Path.cwd().parents] if (p / '.local/control-plane/connection.json').exists()), None)
        if descriptor_file is None:
            descriptor_file = Path(os.environ.get('HEXAGON_LOCAL_DISCOVERY_FILE', str(Path.home() / '.hexagon/local.json')))

    def private_json(path):
        with open(path, 'r', encoding='utf-8') as stream:
            stat = os.fstat(stream.fileno())
            if os.name != 'nt' and (stat.st_mode & 0o077 or stat.st_uid != os.getuid()):
                raise RuntimeError('local_identity_permissions')
            return json.load(stream)

    try:
        descriptor = private_json(descriptor_file)
    except (OSError, ValueError) as error:
        raise RuntimeError('local_workspace_not_found_or_unreadable: start Hexagon locally or set data_directory') from error
    url = urlsplit(descriptor['base_url'])
    if descriptor.get('version') != 1 or url.scheme != 'http' or url.hostname not in ('127.0.0.1', 'localhost', '::1') or url.username or url.password or url.path not in ('', '/') or url.query or url.fragment:
        raise RuntimeError('local_endpoint_required')
    origin = f'{url.scheme}://{url.netloc}'
    if base_url:
        expected = urlsplit(base_url)
        if expected.scheme != 'http' or expected.hostname not in ('127.0.0.1', 'localhost', '::1') or expected.port != url.port or expected.username or expected.password or expected.path not in ('', '/') or expected.query or expected.fragment:
            raise RuntimeError('local_workspace_endpoint_mismatch')
    identity = private_json(Path(descriptor['data_directory']) / 'owner.json')
    if identity.get('tenant') != 'local-workspace' or not isinstance(identity.get('token'), str) or not identity['token']:
        raise RuntimeError('invalid_local_identity')
    return origin, identity['token']
