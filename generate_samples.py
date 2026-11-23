#!/usr/bin/env python3
"""Generate reproducible ZIP fixtures using fictional files only."""
import argparse
import io
from pathlib import Path
from struct import pack
from zlib import crc32
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile, ZipInfo


MIT = (
    "Permission is hereby granted, free of charge, to any person obtaining a copy "
    "of the fictional work, to deal in the Software without restriction.\n"
    "The above copyright notice and this permission notice shall be included."
)
BSD = (
    "Redistribution and use in source and binary forms, with or without modification.\n"
    "1. Redistributions of source code must retain the fictional notice.\n"
    "2. Redistributions in binary form must reproduce the fictional notice."
)
COPYING = "TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION"

LICENSES = {
    "MIT": MIT,
    "BSD-2-Clause": BSD,
    "BSD-3-Clause": BSD + "\n3. Neither the name of the Fictional Workshop may be used to endorse or promote.",
    "Apache-2.0": "Apache License\nVersion 2.0\n1. Definitions\n4. Redistribution",
    "ISC": ("Permission to use, copy, modify, and/or distribute this software.\n"
            "The above copyright notice and this permission notice appear in fictional copies."),
    "Unlicense": ("This is free and unencumbered software released into the public domain.\n"
                  "Anyone is free to copy, modify, publish, use, compile, sell, or distribute.\n"
                  'The software is provided "AS IS", without warranty.'),
    "CC0-1.0": "CC0 1.0 Universal\n2. Waiver\nFictional rights.",
    "GPL-2.0": "GNU GENERAL PUBLIC LICENSE\nVersion 2, fictional fixture\n" + COPYING,
    "GPL-3.0": "GNU GENERAL PUBLIC LICENSE\nVersion 3, fictional fixture\nTERMS AND CONDITIONS\n6. Conveying Non-Source Forms",
    "LGPL-2.1": "GNU LESSER GENERAL PUBLIC LICENSE\nVersion 2.1, fictional fixture\n" + COPYING,
    "LGPL-3.0": ("GNU LESSER GENERAL PUBLIC LICENSE\nVersion 3, fictional fixture\n"
                 "This incorporates the terms and conditions of version 3 of the GNU General Public License.\n4. Combined Works"),
    "AGPL-3.0": "GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, fictional fixture\n13. Remote Network Interaction",
    "MPL-2.0": 'Mozilla Public License Version 2.0\n"Covered Software" means fictional work.\n3.1. Distribution of Source Form',
    "EPL-2.0": 'Eclipse Public License - 2.0\n"Contributor" means a fictional contributor.\n3. Requirements',
    "CC-BY-4.0": "Creative Commons Attribution 4.0 International\nSection 2 – Scope.\nSection 3 – License Conditions.",
    "CC-BY-SA-4.0": "https://creativecommons.org/licenses/by-sa/4.0/legalcode",
    "CC-BY-NC-4.0": "https://creativecommons.org/licenses/by-nc/4.0/",
    "CC-BY-NC-SA-4.0": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    "CC-BY-ND-4.0": "https://creativecommons.org/licenses/by-nd/4.0/",
    "Public Domain": "Dedicated to the public domain.\nFictional fixture.",
}


def add(archive, name, content, method=ZIP_STORED):
    entry = ZipInfo(name)
    entry.create_system = 3
    entry.external_attr = (0o40755 << 16) | 16 if name.endswith("/") else 0o100644 << 16
    archive.writestr(entry, content, compress_type=method)


class UnseekableBuffer(io.BytesIO):
    def seek(self, *args):
        raise io.UnsupportedOperation("fixture uses ZIP data descriptors")


def archive_with(*entries):
    buffer = io.BytesIO()
    with ZipFile(buffer, "w") as archive:
        for name, content in entries:
            add(archive, name, content)
    return buffer.getvalue()


def generate(output):
    output.mkdir(parents=True, exist_ok=True)
    with ZipFile(output / "licenses.zip", "w") as archive:
        for index, (identifier, body) in enumerate(LICENSES.items()):
            folder = f"components/{identifier}/"
            add(archive, folder, "")
            add(archive, folder + ("LICENCE.txt" if index % 2 else "COPYING"), body,
                ZIP_DEFLATED if index % 2 else ZIP_STORED)
            add(archive, folder + "work.txt", "Fictional work.")
        archive.comment = b"Fictional archive comment"

    nested = io.BytesIO()
    with ZipFile(nested, "w") as archive:
        add(archive, "hidden.js", "// SPDX-License-Identifier: AGPL-3.0-only")
    with ZipFile(output / "nested.zip", "w") as archive:
        add(archive, "LICENSE", MIT)
        add(archive, "bundle/one.ZIP", nested.getvalue())
        add(archive, "bundle/bad.zip", b"Fictional non-ZIP.")
        add(archive, "bundle/two.zip", archive_with(
            ("plain.txt", "Fictional file."),
            ("deeper.zip", nested.getvalue()),
            ("vendor/sample/LICENSE", LICENSES["GPL-3.0"]),
            ("vendor/sample/work.txt", "Fictional component."),
        ), ZIP_DEFLATED)
        add(archive, "bundle/empty.zip", archive_with())
    buffer = UnseekableBuffer()
    with ZipFile(buffer, "w") as archive:
        add(archive, "LICENSE", MIT)
        add(archive, "NOTICE", "Fictional project credits.")
        add(archive, "src/main.js", "/* SPDX-License-Identifier: MIT */", ZIP_DEFLATED)
        add(archive, "vendor/copyleft/COPYING.md", LICENSES["GPL-3.0"])
        add(archive, "vendor/copyleft/src/module.js", "// Fictional module", ZIP_DEFLATED)
        add(archive, "vendor/copyleft/override.js", "// SPDX-License-Identifier: Apache-2.0")
        add(archive, "vendor/ambiguous/LICENSE", "Fictional terms without a recognizable pattern.")
        add(archive, "vendor/ambiguous/nothing.js", "Fictional source.")
        add(archive, "vendor/nested.zip", nested.getvalue(), ZIP_DEFLATED)
        add(archive, "素材/LICENCE.txt", LICENSES["CC-BY-NC-SA-4.0"], ZIP_DEFLATED)
        add(archive, "素材/art.svg", "<!-- fictional illustration -->")
        add(archive, "other/expression.js", "// SPDX-License-Identifier: MIT OR (GPL-3.0-only WITH Fictional-exception)")
        add(archive, "other/custom.txt", "SPDX-License-Identifier: LicenseRef-Fictional")
        add(archive, "other/vendor-license.txt", "SPDX-License-Identifier: MIT OR")
        add(archive, "other/<偽>|[資料].txt", "Fictional notes.")
    (output / "mixed.zip").write_bytes(buffer.getvalue())

    with ZipFile(output / "boundaries.zip", "w") as archive:
        add(archive, "vendor/asset.png", b"Fictional binary placeholder.")
        add(archive, "local.txt", "Fictional text without license.")
        add(archive, "unicode.js", "あ" * 683 + "\n// SPDX-License-Identifier: MIT", ZIP_DEFLATED)
        add(archive, "prefix.js", "// SPDX-License-Identifier: MIT\n" + "x" * 8192, ZIP_DEFLATED)
        add(archive, "large.js", "x" * (1024 ** 2 + 1), ZIP_DEFLATED)
        add(archive, "other/NOTICE", "Fictional credits.")
        add(archive, "other/AUTHORS.md", "Fictional Workshop.")
        add(archive, "other/CREDITS", "Fictional Workshop.")
        add(archive, "other/art.svg", "<!-- SPDX-License-Identifier: CC-BY-4.0 -->")
        add(archive, "broken.txt", "SPDX-License-Identifier: MIT")
        add(archive, "late-crc.txt", "SPDX-License-Identifier: MIT\n" + "x" * 3000)
        add(archive, "collision", "Fictional file.")
        add(archive, "collision/LICENSE", MIT)
        add(archive, "collision/work.txt", "Fictional file.")
        add(archive, "invalid/LICENSE", "This mentions https://creativecommons.org/licenses/by/4.0/.")
        add(archive, "invalid/work.txt", "Fictional file.")
        add(archive, "ratio.js", "x" * 70000, ZIP_DEFLATED)
        add(archive, "../unsafe.js", "// SPDX-License-Identifier: MIT")
    # Change stored data without changing the CRC.
    fixture = output / "boundaries.zip"
    data = bytearray(fixture.read_bytes())
    with ZipFile(fixture) as archive:
        for name, offset in [("broken.txt", 0), ("late-crc.txt", 2500)]:
            local = archive.getinfo(name).header_offset
            data[local + 30 + len(name) + offset] ^= 1
    fixture.write_bytes(data)

    budget = bytearray(archive_with(("a.txt", "x" * 32), ("b.txt", "too big"), ("c.txt", "ok")))
    budget[30 + len("a.txt")] ^= 1
    (output / "budgets.zip").write_bytes(budget)

    with ZipFile(output / "encoding.zip", "w") as archive:
        placeholders = [("A000.js", "資料.js".encode("cp932")), ("B000.js", b"fake.js")]
        for placeholder, raw in placeholders:
            entry = ZipInfo(placeholder)
            if placeholder.startswith("B"):
                extra = pack("<BI", 1, crc32(raw)) + "見本.js".encode()
                entry.extra = pack("<HH", 0x7075, len(extra)) + extra
            archive.writestr(entry, "架空\n// SPDX-License-Identifier: MIT".encode("cp932"))
    encoding = output / "encoding.zip"
    encoded = encoding.read_bytes()
    for placeholder, raw in placeholders:
        encoded = encoded.replace(placeholder.encode(), raw)
    encoding.write_bytes(encoded)

    with ZipFile(output / "empty.zip", "w"):
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", type=Path, default=Path("samples"))
    generate(parser.parse_args().output)
