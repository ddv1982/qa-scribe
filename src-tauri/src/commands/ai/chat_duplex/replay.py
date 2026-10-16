import json
from pathlib import Path


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

    transcript = expand(transcript)

    def expect(expected, release):
        actual = receive()
        assert actual == expected, f'{release}: expected {expected}, received {actual}'
        record({'replay_release': release, 'verified_outbound': actual})

    expect(transcript['initial'], 'initial')
    for step in transcript['steps']:
        if step['op'] == 'receive':
            assert 'error' not in step
            if {'complete': True} in step['events']:
                record({'replay_terminal': transcript['finish']})
            send(step['frame'])
            for event in step['events']:
                if 'send' in event:
                    expect(event['send'], step['release'])
        elif step['op'] == 'decide':
            expect(step['reply'], step['release'])
        else:
            assert step['op'] == 'next_permission'
