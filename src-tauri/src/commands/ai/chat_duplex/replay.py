import json
from pathlib import Path


def expected_cwd_frame(expected, actual, cwd):
    if expected.get('method') not in ('thread/start', 'session/new'):
        return expected
    if expected.get('params', {}).get('cwd') != '$CWD':
        return expected
    actual_cwd = actual.get('params', {}).get('cwd')
    if not isinstance(actual_cwd, str):
        return expected
    try:
        equivalent = Path(cwd).is_dir() and Path(actual_cwd).is_dir() and Path(cwd).samefile(actual_cwd)
    except OSError:
        equivalent = False
    if equivalent:
        return {**expected, 'params': {**expected['params'], 'cwd': actual_cwd}}
    return expected


def run(name, cwd, app_version, receive, send, record):
    path = Path(__file__).resolve().parents[5] / 'e2e/fixtures/chat-replay' / name
    transcript = json.loads(path.read_text())
    assert transcript['version'] == 1
    assert transcript['cli_version'] == 'synthetic'
    assert transcript['process'] is True

    def expand(value):
        if isinstance(value, str):
            return {'$CWD': cwd, '$APP_VERSION': app_version}.get(value, value)
        if isinstance(value, list):
            return [expand(item) for item in value]
        if isinstance(value, dict):
            return {key: expand(item) for key, item in value.items()}
        return value

    def expect(expected, release):
        actual = receive()
        expected = expand(expected_cwd_frame(expected, actual, cwd))
        assert actual == expected, f'{release}: expected {expected}, received {actual}'
        record({'replay_release': release, 'verified_outbound': actual})

    expect(transcript['initial'], 'initial')
    for step in transcript['steps']:
        if step['op'] == 'receive':
            assert 'error' not in step
            if {'complete': True} in step['events']:
                record({'replay_terminal': expand(transcript['finish'])})
            send(expand(step['frame']))
            for event in step['events']:
                if 'send' in event:
                    expect(event['send'], step['release'])
        elif step['op'] == 'decide':
            expect(step['reply'], step['release'])
        else:
            assert step['op'] == 'next_permission'
