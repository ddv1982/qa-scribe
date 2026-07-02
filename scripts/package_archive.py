#!/usr/bin/env python3
"""Shared archive helpers for qa-scribe packaging checks."""

from __future__ import annotations

import io
import pathlib
import shutil
import subprocess
import tarfile
from collections.abc import Callable
import xml.etree.ElementTree as ET


def read_ar_entries(deb_path: pathlib.Path) -> dict[str, bytes]:
    entries: dict[str, bytes] = {}
    with deb_path.open("rb") as handle:
        if handle.read(8) != b"!<arch>\n":
            raise ValueError(f"{deb_path} is not a Debian ar archive")

        while True:
            header = handle.read(60)
            if not header:
                break
            if len(header) != 60 or header[58:60] != b"`\n":
                raise ValueError(f"{deb_path} has an invalid ar member header")

            name = header[:16].decode("utf-8", errors="replace").strip().rstrip("/")
            try:
                size = int(header[48:58].decode("ascii").strip())
            except ValueError as error:
                raise ValueError(f"{deb_path} has an invalid ar member size") from error

            data = handle.read(size)
            if len(data) != size:
                raise ValueError(f"{deb_path} has a truncated ar member")
            if size % 2 == 1:
                handle.read(1)
            entries[name] = data
    return entries


def tar_data_and_mode(archive_name: str, data: bytes) -> tuple[bytes, str, str]:
    if not archive_name.endswith(".tar.zst"):
        return data, "r:*", "python-ar+tarfile"

    zstd = shutil.which("zstd")
    if not zstd:
        raise ValueError(f"{archive_name} requires the zstd command")
    completed = subprocess.run(
        [zstd, "-dc"],
        input=data,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if completed.returncode != 0:
        raise ValueError(completed.stderr.decode("utf-8", errors="replace"))
    return completed.stdout, "r:", "python-ar+zstd+tarfile"


def extract_tar_member(
    archive_name: str,
    data: bytes,
    predicate: Callable[[str], bool],
) -> dict[str, bytes]:
    data, mode, _ = tar_data_and_mode(archive_name, data)
    found: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode=mode) as tar:
        for member in tar.getmembers():
            normalized = member.name.removeprefix("./")
            if not member.isfile() or not predicate(normalized):
                continue
            extracted = tar.extractfile(member)
            if extracted is not None:
                found[normalized] = extracted.read()
    return found


def parse_desktop_file(data: bytes) -> dict[str, str]:
    fields: dict[str, str] = {}
    in_desktop_entry = False
    for raw_line in data.decode("utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            in_desktop_entry = line == "[Desktop Entry]"
            continue
        if in_desktop_entry and "=" in line:
            key, value = line.split("=", 1)
            fields[key] = value
    return fields


def strip_ns(name: str) -> str:
    return name.rsplit("}", 1)[-1]


def child_text(element: ET.Element, tag_name: str) -> str | None:
    for child in element:
        if strip_ns(child.tag) == tag_name and child.text:
            return child.text.strip()
    return None


def descendant_text(element: ET.Element, tag_name: str) -> str | None:
    for child in element.iter():
        if strip_ns(child.tag) == tag_name and child.text:
            return child.text.strip()
    return None


def launchable_desktop_id(element: ET.Element) -> str | None:
    for child in element.iter():
        if strip_ns(child.tag) == "launchable" and child.attrib.get("type") == "desktop-id":
            return (child.text or "").strip() or None
    return None


def first_release(element: ET.Element) -> tuple[str | None, str | None]:
    for child in element.iter():
        if strip_ns(child.tag) == "release":
            return child.attrib.get("version"), child.attrib.get("date")
    return None, None


def safe_extract_tar(tar: tarfile.TarFile, destination: pathlib.Path) -> None:
    destination = destination.resolve()
    for member in tar.getmembers():
        output_path = destination / member.name.removeprefix("./")
        try:
            output_path.resolve().relative_to(destination)
        except ValueError as error:
            raise ValueError(f"refusing unsafe tar member path: {member.name}") from error
        if member.isdir():
            output_path.mkdir(parents=True, exist_ok=True)
            continue
        if not member.isreg():
            raise ValueError(f"refusing non-regular tar member: {member.name}")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        source = tar.extractfile(member)
        if source is None:
            raise ValueError(f"could not read tar member: {member.name}")
        with source, output_path.open("wb") as handle:
            shutil.copyfileobj(source, handle)
        output_path.chmod(member.mode & 0o777)


def extract_data_archive(data_name: str, data: bytes, destination: pathlib.Path) -> str:
    data, mode, extraction = tar_data_and_mode(data_name, data)
    with tarfile.open(fileobj=io.BytesIO(data), mode=mode) as tar:
        safe_extract_tar(tar, destination)
    return extraction
