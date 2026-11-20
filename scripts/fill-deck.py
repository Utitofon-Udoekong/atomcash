"""Fill the BLAZE Widget Factory deck with AtomCash. Layout and pictures stay."""

from __future__ import annotations

import copy
import shutil
from pathlib import Path

from pptx import Presentation
from pptx.oxml.ns import qn

SOURCE = Path(r"C:\Users\utito\Downloads\BLAZE 2026 Project Template.pptx")
OUTPUTS = [
    Path(r"C:\Users\utito\Downloads\AtomCash BLAZE 2026.pptx"),
    Path(r"C:\Users\utito\Documents\projects\atomcash\public\AtomCash-BLAZE-2026.pptx"),
]


def set_paragraph(paragraph, text: str) -> None:
    if not paragraph.runs:
        paragraph.text = text
        return
    paragraph.runs[0].text = text
    for run in paragraph.runs[1:]:
        run.text = ""
        clear_hyperlink(run)
    clear_hyperlink(paragraph.runs[0])


def clear_hyperlink(run) -> None:
    properties = run._r.find(qn("a:rPr"))
    if properties is None:
        return
    for child in list(properties):
        if child.tag == qn("a:hlinkClick"):
            properties.remove(child)


def shape(slide, shape_id: int):
    for item in slide.shapes:
        if item.shape_id == shape_id:
            return item
    raise KeyError(shape_id)


def write_shape(slide, shape_id: int, lines: list[str]) -> None:
    frame = shape(slide, shape_id).text_frame
    paragraphs = list(frame.paragraphs)
    if len(lines) != len(paragraphs):
        raise ValueError(f"shape {shape_id}: {len(lines)} lines, {len(paragraphs)} paragraphs")
    for paragraph, line in zip(paragraphs, lines):
        set_paragraph(paragraph, line)


def duplicate_slide(prs: Presentation, index: int):
    source = prs.slides[index]
    dest = prs.slides.add_slide(source.slide_layout)
    for item in list(dest.shapes):
        item._element.getparent().remove(item._element)
    id_map: dict[str, str] = {}
    for rel in source.part.rels.values():
        if "notesSlide" in rel.reltype:
            continue
        if rel.is_external:
            id_map[rel.rId] = dest.part.rels.get_or_add_ext_rel(rel.reltype, rel.target_ref)
        else:
            id_map[rel.rId] = dest.part.relate_to(rel.target_part, rel.reltype)
    dest_tree = dest.shapes._spTree
    for child in source.shapes._spTree:
        if child.tag in {qn("p:nvGrpSpPr"), qn("p:grpSpPr")}:
            continue
        cloned = copy.deepcopy(child)
        for element in cloned.iter():
            for attribute, value in list(element.attrib.items()):
                if value in id_map and attribute.endswith("}embed") or (
                    value in id_map and attribute.endswith("}link")
                ):
                    element.attrib[attribute] = id_map[value]
        dest_tree.append(cloned)
    return dest


def fill(prs: Presentation) -> None:
    slides = list(prs.slides)
    write_shape(slides[0], 58, ["AtomCash"])
    write_shape(slides[0], 70, ["Team [BLANK]"])
    write_shape(slides[0], 60, ["[BLANK]"])
    write_shape(slides[0], 61, ["[BLANK]"])
    write_shape(slides[0], 62, ["[BLANK]"])

    write_shape(
        slides[1],
        78,
        [
            "AtomCash",
            "",
            "Same-chain atomic swap. No custodian.",
            "",
            "Repository [BLANK]",
            "",
        ],
    )

    write_shape(slides[2], 95, ["The problem"])
    write_shape(slides[2], 87, ["No middleman"])
    write_shape(slides[2], 88, ["[BLANK]"])
    write_shape(
        slides[2],
        93,
        [
            "A swap of BCH and CashTokens should not mean handing both assets to someone else. That person can keep one side, or change who gets paid.",
            "",
            "AtomCash locks each side in its own covenant. The only ways out are the agreed payout, or a refund after the timeout.",
        ],
    )

    write_shape(slides[3], 107, ["", "What you can do"])
    write_shape(
        slides[3],
        108,
        [
            "Connect with WizardConnect",
            "Chipnet or mainnet",
            "BCH or a CashToken",
            "Read the claim transaction id",
            "Refund after the timeout",
            "Open the same contract in XO",
        ],
    )

    write_shape(
        slides[4],
        116,
        [
            "Send BCH",
            "",
            "Click Mainnet, connect, and create a swap.",
            "The wallet broadcasts a real mainnet BCH transaction.",
            "",
            "",
        ],
    )

    write_shape(slides[5], 126, ["", "How it works"])
    write_shape(
        slides[5],
        127,
        [
            "Two contracts. One preimage.",
            "Alice's timeout is later than Bob's",
            "Claim checks the lock, category, and amount",
            "Refund pays only the refund address",
            "One wrong byte is not broadcast",
        ],
    )

    write_shape(slides[6], 135, ["THANK YOU"])

    judge = duplicate_slide(prs, 3)
    one_byte = duplicate_slide(prs, 4)
    links = duplicate_slide(prs, 4)

    # Duplicated shapes keep the source ids.
    write_shape(judge, 107, ["", "For a judge"])
    write_shape(
        judge,
        108,
        [
            "Connect WizardConnect",
            "Pick BCH or a token",
            "Create the swap and send",
            "The slip shows the claim id",
            "Flip one preimage byte",
            "Refund after about 3 minutes",
        ],
    )

    write_shape(
        one_byte,
        116,
        [
            "One byte",
            "",
            "Change one byte of the preimage.",
            "The claim stops. Both sides can still refund.",
            "",
            "",
        ],
    )

    write_shape(
        links,
        116,
        [
            "Links",
            "",
            "Repository [BLANK]",
            "EMBER2026 bitcoincash:zq5hh46r4kudjpsayg58gu99h03p00nw4csaumqgy0",
            "",
            "",
        ],
    )

    prs.core_properties.title = "AtomCash"
    prs.core_properties.subject = "BCH BLAZE 2026"
    prs.core_properties.category = "AtomCash"


def main() -> None:
    prs = Presentation(str(SOURCE))
    fill(prs)
    for output in OUTPUTS:
        output.parent.mkdir(parents=True, exist_ok=True)
        prs.save(str(output))
        print(output, output.stat().st_size)


if __name__ == "__main__":
    main()
