#!/usr/bin/env python3
"""The packages e2e/server.sh publishes: a wheel, a .deb, a Maven jar with its POM and an npm
package, built with the standard library only, so that macOS needs no dpkg-deb and CI no
build tools. Each is the smallest file the server takes for its format.

    python3 e2e/fixtures.py DIR

writes DIR/lajstrom_e2e_demo-1.0.0-py3-none-any.whl, DIR/hello-e2e_1.0.0-1_all.deb,
DIR/maven/ (demo-1.0.0.jar, demo-1.0.0.pom, maven-metadata.xml) and DIR/npm/ (package.json,
index.js).
"""

import base64
import hashlib
import io
import json
import os
import sys
import tarfile
import time
import zipfile

# The start of the UTC day: the same bytes on every run of a day, and a time the server takes
# (it refuses a created time far from its clock).
NOW = int(time.time()) // 86400 * 86400


def wheel(out):
    name, version = "lajstrom_e2e_demo", "1.0.0"
    info = f"{name}-{version}.dist-info"
    files = {
        f"{name}/__init__.py": b'"""A package the UI\'s end-to-end test publishes."""\n',
        f"{info}/METADATA": (
            "Metadata-Version: 2.1\n"
            "Name: lajstrom-e2e-demo\n"
            f"Version: {version}\n"
            "Summary: A package the UI's end-to-end test publishes\n"
            "Requires-Python: >=3.8\n"
        ).encode(),
        f"{info}/WHEEL": b"Wheel-Version: 1.0\nGenerator: lajstrom-ui-e2e\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
    }
    record = ""
    for path, data in files.items():
        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
        record += f"{path},sha256={digest},{len(data)}\n"
    files[f"{info}/RECORD"] = (record + f"{info}/RECORD,,\n").encode()
    path = os.path.join(out, f"{name}-{version}-py3-none-any.whl")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for p, data in files.items():
            entry = zipfile.ZipInfo(p, time.gmtime(NOW)[:6])
            entry.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(entry, data)
    return path


def targz(members):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.GNU_FORMAT) as t:
        for name, data, mode in members:
            entry = tarfile.TarInfo(name)
            entry.mtime, entry.uname, entry.gname = NOW, "root", "root"
            if data is None:
                entry.type, entry.mode = tarfile.DIRTYPE, 0o755
                t.addfile(entry)
            else:
                entry.size, entry.mode = len(data), mode
                t.addfile(entry, io.BytesIO(data))
    return buf.getvalue()


def ar(members):
    """An ar archive in the common format dpkg reads: debian-binary first."""
    out = b"!<arch>\n"
    for name, data in members:
        header = f"{name:<16}{NOW:<12}{0:<6}{0:<6}{0o100644:<8o}{len(data):<10}`\n".encode()
        out += header + data + (b"\n" if len(data) % 2 else b"")
    return out


def deb(out):
    readme = b"hello-e2e: a package the UI's end-to-end test publishes.\n"
    control = (
        "Package: hello-e2e\n"
        "Version: 1.0.0-1\n"
        "Architecture: all\n"
        "Maintainer: Lajstrom UI e2e <e2e@example.com>\n"
        "Installed-Size: 1\n"
        "Section: misc\n"
        "Priority: optional\n"
        "Description: A package the UI's end-to-end test publishes\n"
        " It holds one file, its README.\n"
    ).encode()
    md5sums = f"{hashlib.md5(readme).hexdigest()}  usr/share/doc/hello-e2e/README\n".encode()
    data = targz(
        [
            ("./", None, 0),
            ("./usr/", None, 0),
            ("./usr/share/", None, 0),
            ("./usr/share/doc/", None, 0),
            ("./usr/share/doc/hello-e2e/", None, 0),
            ("./usr/share/doc/hello-e2e/README", readme, 0o644),
        ]
    )
    ctl = targz([("./", None, 0), ("./control", control, 0o644), ("./md5sums", md5sums, 0o644)])
    path = os.path.join(out, "hello-e2e_1.0.0-1_all.deb")
    with open(path, "wb") as f:
        f.write(ar([("debian-binary", b"2.0\n"), ("control.tar.gz", ctl), ("data.tar.gz", data)]))
    return path


def maven(out):
    group, artifact, version = "com.example.e2e", "demo", "1.0.0"
    d = os.path.join(out, "maven")
    os.makedirs(d, exist_ok=True)
    with zipfile.ZipFile(os.path.join(d, f"{artifact}-{version}.jar"), "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(zipfile.ZipInfo("META-INF/MANIFEST.MF", time.gmtime(NOW)[:6]), "Manifest-Version: 1.0\r\n\r\n")
    pom = f"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>{group}</groupId>
  <artifactId>{artifact}</artifactId>
  <version>{version}</version>
  <packaging>jar</packaging>
  <name>Demo</name>
  <description>A library the UI's end-to-end test publishes.</description>
</project>
"""
    with open(os.path.join(d, f"{artifact}-{version}.pom"), "w") as f:
        f.write(pom)
    stamp = time.strftime("%Y%m%d%H%M%S", time.gmtime(NOW))
    metadata = f"""<?xml version="1.0" encoding="UTF-8"?>
<metadata>
  <groupId>{group}</groupId>
  <artifactId>{artifact}</artifactId>
  <versioning>
    <latest>{version}</latest>
    <release>{version}</release>
    <versions>
      <version>{version}</version>
    </versions>
    <lastUpdated>{stamp}</lastUpdated>
  </versioning>
</metadata>
"""
    with open(os.path.join(d, "maven-metadata.xml"), "w") as f:
        f.write(metadata)
    return d


def npm(out):
    d = os.path.join(out, "npm")
    os.makedirs(d, exist_ok=True)
    package = {
        "name": "@e2e/widgets",
        "version": "1.0.0",
        "description": "A package the UI's end-to-end test publishes",
        "main": "index.js",
        "license": "Apache-2.0",
    }
    with open(os.path.join(d, "package.json"), "w") as f:
        json.dump(package, f, indent=2)
    with open(os.path.join(d, "index.js"), "w") as f:
        f.write('module.exports = () => "widgets 1.0.0";\n')
    return d


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: fixtures.py DIR")
    os.makedirs(sys.argv[1], exist_ok=True)
    for build in (wheel, deb, maven, npm):
        print(build(sys.argv[1]))
