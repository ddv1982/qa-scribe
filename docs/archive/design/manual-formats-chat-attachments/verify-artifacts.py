from pathlib import Path
import json
import re
import struct

folder = Path(__file__).resolve().parent
repo = folder.parents[2]
prototype = (folder / 'prototype.html').read_text()
catalog = (repo / 'frontend/src/testware/generationPreferences.ts').read_text()
formats = re.search(r'const formats=\[(.*?)\];', prototype).group(1)
actual = re.findall(r"\['([^']+)'", formats)
expected = re.findall(r"id: '([^']+)'", catalog.split('testwareOutputFormatOptions:')[1].split('export const testwareDepthOptions')[0])
assert actual == expected, (actual, expected)
screenshots = {'01-manual-test-cases': 1280, '02-manual-finding': 1280, '03-chat-attachments': 1280, '04-gherkin': 1280, '05-chat-narrow': 728, '06-chat-light-narrow': 360, '07-message-preserved': 1280}
for name, expected_width in screenshots.items():
    data = (folder / (name + '.png')).read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', name
    width, height = struct.unpack('>II', data[16:24])
    assert width == expected_width and height >= 800, (name, width, height)
    print(f'{name}.png {width}x{height}')
assert (folder / 'evidence.png').is_file()
assert "id=\"attach\"" in prototype and "id=\"send\"" in prototype
assert prototype.index('id="attach"') < prototype.index('id="send"')
receipt = json.loads((folder / 'removal-native-receipt.json').read_text())
assert receipt['removeControlVisible'] is False
assert any(receipt['expectedMessage'] in line for line in receipt['observedMessageLines'])
for render in json.loads((folder / 'render-receipts.json').read_text()).values():
    assert render['consoleMessages'] == []
print('Format catalog, seven screenshots, render metadata, and native observation receipt verified.')
