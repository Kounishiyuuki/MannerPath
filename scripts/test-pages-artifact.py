#!/usr/bin/env python3
"""Build real tar archives and probe permissions, links and artifact paths."""
import importlib.util
import os
from pathlib import Path, PurePosixPath
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('pages_package', ROOT / 'scripts/package-pages-artifact.py')
pages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages)


class PagesArtifactTests(unittest.TestCase):
    def assert_safe(self, path):
        with tarfile.open(path) as archive:
            members = archive.getmembers()
            self.assertTrue(members)
            for member in members:
                self.assertTrue(member.isdir() or member.isfile())
                self.assertEqual(member.mode, 0o755 if member.isdir() else 0o644)
                self.assertEqual((member.uid, member.gid, member.uname, member.gname, member.mtime), (0, 0, '', '', 0))
                self.assertFalse(PurePosixPath(member.name).is_absolute())
                self.assertNotIn('..', PurePosixPath(member.name).parts)
                self.assertNotIn('\\', member.name)
            return {m.name: archive.extractfile(m).read() for m in members if m.isfile()}

    def test_world_writable_and_executable_permissions_are_normalized(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            site = root / 'site'
            nested = site / 'nested'
            nested.mkdir(parents=True)
            nested.chmod(0o777)
            page = nested / 'index.html'
            page.write_bytes(b'<p>public</p>')
            page.chmod(0o777)
            output = root / 'artifact.tar'
            pages.package_site(site, output)
            self.assertEqual(self.assert_safe(output), {'nested/index.html': page.read_bytes()})
            self.assertEqual(page.stat().st_mode & 0o777, 0o777, 'source permissions stay untouched')
            self.assertEqual(nested.stat().st_mode & 0o777, 0o777)

    def test_actual_site_bytes_and_permissions(self):
        site = ROOT / 'site'
        expected = {}
        for path in site.rglob('*'):
            self.assertFalse(path.is_symlink())
            if path.is_file():
                self.assertEqual(path.stat().st_mode & 0o111, 0, 'the public site requires no executables')
                expected[path.relative_to(site).as_posix()] = path.read_bytes()
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'artifact.tar'
            pages.package_site(site, output)
            self.assertEqual(self.assert_safe(output), expected)

    def test_symlink_file_directory_and_root_are_refused(self):
        for kind in ('file', 'directory', 'root'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                outside = root / 'outside'
                outside.mkdir()
                (outside / 'private.html').write_text('must not publish')
                site = root / 'site'
                if kind == 'root':
                    site.symlink_to(outside, target_is_directory=True)
                else:
                    site.mkdir()
                    (site / 'link').symlink_to(outside if kind == 'directory' else outside / 'private.html')
                output = root / 'artifact.tar'
                output.write_bytes(b'previous complete archive')
                with self.assertRaises((ValueError, OSError)):
                    pages.package_site(site, output)
                self.assertEqual(output.read_bytes(), b'previous complete archive')
                self.assertEqual(list(root.glob('.pages-*')), [])

    def test_special_files_and_unsafe_names_are_refused(self):
        for kind in ('fifo', 'unsafe-name'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                site = root / 'site'
                site.mkdir()
                if kind == 'fifo':
                    os.mkfifo(site / 'pipe')
                else:
                    (site / 'bad\\name').write_text('bad')
                with self.assertRaises(ValueError):
                    pages.package_site(site, root / 'artifact.tar')
                self.assertFalse((root / 'artifact.tar').exists())
        for name in ('..', '../outside', '/absolute', 'a\\b', 'a\nb'):
            with self.assertRaises(ValueError):
                pages.safe_component(name)

    def test_hardlinks_become_regular_files_and_metadata_is_excluded(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            site = root / 'site'
            site.mkdir()
            (site / 'index.html').write_bytes(b'public')
            os.link(site / 'index.html', site / 'copy.html')
            for name in ('.git', '.github'):
                (site / name).mkdir()
                (site / name / 'metadata').write_bytes(b'not public')
            output = root / 'artifact.tar'
            pages.package_site(site, output)
            self.assertEqual(self.assert_safe(output), {'index.html': b'public', 'copy.html': b'public'})

    def test_archive_output_cannot_be_in_site(self):
        with tempfile.TemporaryDirectory() as folder:
            site = Path(folder)
            with self.assertRaises(ValueError):
                pages.package_site(site, site / 'artifact.tar')


if __name__ == '__main__':
    unittest.main()
