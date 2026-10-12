#!/usr/bin/env python3
"""Build the Pages artifact.tar from site only, with normalized archive metadata.

No source chmod, symlink dereference, special files, hard-link archive entries or
host extended attributes. Directory-relative no-follow opens also reject swapped
symlinks while packaging. The output is replaced only after a complete archive.
"""
import argparse
import os
from pathlib import Path
import stat
import tarfile
import tempfile


def safe_component(name):
    if name in ('.', '..') or '/' in name or '\\' in name or any(ord(c) < 32 or ord(c) == 127 for c in name):
        raise ValueError('unsafe Pages archive name')
    return name


def add_directory(archive, directory_fd, prefix=''):
    info = tarfile.TarInfo(prefix or '.')
    info.type = tarfile.DIRTYPE
    info.mode = 0o755
    archive.addfile(info)
    for name in sorted(os.listdir(directory_fd)):
        if name in ('.git', '.github'):
            continue
        safe_component(name)
        member_name = f'{prefix}/{name}' if prefix else name
        entry = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        if stat.S_ISDIR(entry.st_mode):
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory_fd)
            try:
                add_directory(archive, child, member_name)
            finally:
                os.close(child)
        elif stat.S_ISREG(entry.st_mode):
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
            with os.fdopen(fd, 'rb') as body:
                current = os.fstat(body.fileno())
                if not stat.S_ISREG(current.st_mode):
                    raise ValueError('Pages input changed to a special file')
                info = tarfile.TarInfo(member_name)
                info.mode = 0o644
                info.size = current.st_size
                archive.addfile(info, body)
        else:
            raise ValueError('Pages input must contain only directories and regular files; links are forbidden')


def package_site(site, output):
    site, output = Path(site), Path(output)
    # Packaging into the input tree could recursively include a previous archive.
    if output.resolve().is_relative_to(site.resolve()):
        raise ValueError('Pages artifact output must be outside site')
    root = os.open(site, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=output.parent, prefix='.pages-', delete=False) as file:
            temporary = Path(file.name)
            with tarfile.open(fileobj=file, mode='w', format=tarfile.PAX_FORMAT) as archive:
                add_directory(archive, root)
        os.replace(temporary, output)
        temporary = None
    finally:
        os.close(root)
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        package_site(args.site, args.output)
    except (OSError, ValueError, tarfile.TarError):
        parser.exit(1, 'Pages packaging refused an unsafe or unreadable input/output\n')


if __name__ == '__main__':
    main()
