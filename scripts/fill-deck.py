"""Fill the Nostrobridge BLAZE deck with AtomCash. Pictures and layout stay."""

from __future__ import annotations

from pathlib import Path

from pptx import Presentation
from pptx.oxml.ns import qn

SOURCE = Path(r"C:\Users\utito\Downloads\BLAZE-2026-Nostrobridge.pptx")
OUTPUTS = [
    Path(r"C:\Users\utito\Downloads\AtomCash BLAZE 2026.pptx"),
    Path(r"C:\Users\utito\Documents\projects\atomcash\public\AtomCash.pptx"),
]
GITHUB = "https://github.com/Utitofon-Udoekong/atomcash"


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


def write_title(slide, shape_id: int, first: str, second: str) -> None:
    paragraph = shape(slide, shape_id).text_frame.paragraphs[0]
    runs = list(paragraph.runs)
    if len(runs) < 2:
        raise ValueError(f"shape {shape_id}: expected two runs")
    runs[0].text = first
    runs[1].text = second


def fill(prs: Presentation) -> None:
    slides = list(prs.slides)
    title, pitch, story, benefits, usage, vision, walk, screen, thanks = slides

    write_shape(title, 58, ["AtomCash"])
    write_shape(title, 60, [GITHUB])
    write_shape(title, 64, ["Utitofon Udoekong"])

    write_shape(
        pitch,
        72,
        [
            "AtomCash",
            "",
            "Same-chain atomic swap for BCH and CashTokens.",
            "",
            GITHUB,
            "",
        ],
    )

    write_shape(story, 81, ["SWAP"])
    write_shape(story, 82, ["www.bchblaze.cash"])
    write_shape(
        story,
        87,
        [
            "A BCH and CashToken swap usually hands both assets to an exchange. That person can keep one side, freeze the trade, or change the payout.",
            "",
            "AtomCash locks each asset in its own covenant. One preimage pays both sides. A timeout sends each deposit home.",
        ],
    )
    write_shape(story, 89, ["The Story of AtomCash"])

    write_title(benefits, 101, "Benefits of", "AtomCash")
    write_shape(
        benefits,
        102,
        [
            "Mainnet wallet connect",
            "BCH or any CashToken",
            "One preimage releases both",
            "One wrong byte is rejected",
            "Refund in three minutes",
            "No custodian",
        ],
    )

    write_shape(
        usage,
        110,
        [
            "BCH Usage",
            "",
            "Click Connect and create a swap. The wallet broadcasts a real mainnet BCH transaction.",
            "Claim pays the other asset. Change one byte and the claim stops. A refund pays the funding address.",
            "",
            "",
        ],
    )

    write_title(vision, 120, "The Vision for", "AtomCash")
    write_shape(
        vision,
        121,
        [
            "A same-chain swap any BCH wallet can offer.",
            "One preimage, two contracts",
            "The covenant checks the payout",
            "Next: a public counterparty",
            "No custodian holds the coins",
        ],
    )

    write_title(walk, 131, "Walk through", "AtomCash")
    write_shape(
        walk,
        132,
        [
            "Open the page and connect",
            "The cashaddr fills in by itself",
            "Pick the amount, or a percent",
            "Create transaction and approve",
            "Claim payout, or refund",
            "One wrong byte fails closed",
        ],
    )

    write_title(screen, 142, "On screen", "AtomCash")
    write_shape(
        screen,
        143,
        [
            "Balances sit above You send",
            "25, 50, 75, and 100 are buttons",
            "The fee line reads 1,800 sats",
            "A bad preimage shows secret",
            "The page never holds a key",
            "Mainnet is the only network",
        ],
    )

    write_shape(thanks, 151, ["THANK YOU!"])
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
