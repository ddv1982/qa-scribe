import io
import pathlib
import tarfile
import tempfile
import unittest

import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))

from package_archive import extract_data_archive, extract_tar_member, read_ar_entries


class PackageArchiveTests(unittest.TestCase):
    def test_read_ar_entries_handles_padding_and_members(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = pathlib.Path(temp) / "sample.deb"
            archive.write_bytes(ar_archive_bytes({"control.tar.xz": b"abc", "data.tar.xz": b"even"}))

            entries = read_ar_entries(archive)

        self.assertEqual(entries, {"control.tar.xz": b"abc", "data.tar.xz": b"even"})

    def test_extract_tar_member_returns_matching_regular_files(self):
        data = tar_bytes({"./control": b"Package: qa-scribe\n", "./ignored": b"skip"})

        files = extract_tar_member("control.tar.xz", data, lambda name: name == "control")

        self.assertEqual(files, {"control": b"Package: qa-scribe\n"})

    def test_extract_data_archive_rejects_unsafe_member_path(self):
        data = tar_bytes({"../escape": b"no"})

        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(ValueError, "refusing unsafe tar member path"):
                extract_data_archive("data.tar.xz", data, pathlib.Path(temp))


def ar_archive_bytes(entries: dict[str, bytes]) -> bytes:
    archive = bytearray(b"!<arch>\n")
    for name, data in entries.items():
        encoded_name = f"{name}/".encode("ascii")
        if len(encoded_name) > 16:
            raise ValueError("test ar member name is too long")
        header = b"".join(
            [
                encoded_name.ljust(16),
                b"0".ljust(12),
                b"0".ljust(6),
                b"0".ljust(6),
                b"100644".ljust(8),
                str(len(data)).encode("ascii").ljust(10),
                b"`\n",
            ]
        )
        archive.extend(header)
        archive.extend(data)
        if len(data) % 2 == 1:
            archive.extend(b"\n")
    return bytes(archive)


def tar_bytes(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as tar:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


if __name__ == "__main__":
    unittest.main()
