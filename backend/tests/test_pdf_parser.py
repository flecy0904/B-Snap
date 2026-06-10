import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import fitz  # type: ignore[import-untyped]
from fastapi import HTTPException
from PIL import Image

from backend.app.routes.uploads import _store_upload
from backend.app.services.note_page_content import merge_page_state_content, parse_page_state
from backend.app.services.pdf_parser import PdfParsingError, parse_pdf_bytes, parse_pdf_path
from backend.app.services.rag_chunker import IndexSource, build_text_chunks


def _simple_text_pdf_bytes() -> bytes:
    document = fitz.open()
    page = document.new_page(width=360, height=240)
    page.insert_text((48, 64), "Chapter 1")
    page.insert_text((48, 96), "Multiplexing and demultiplexing")
    return document.tobytes()


def _image_pdf_bytes() -> bytes:
    image_buffer = BytesIO()
    Image.new("RGB", (24, 18), color=(120, 170, 230)).save(image_buffer, format="PNG")
    document = fitz.open()
    page = document.new_page(width=360, height=240)
    page.insert_text((48, 48), "Image block page")
    page.insert_image(fitz.Rect(48, 72, 144, 144), stream=image_buffer.getvalue())
    return document.tobytes()


def _layout_metadata_pdf_bytes() -> bytes:
    document = fitz.open()
    page = document.new_page(width=360, height=240)
    page.insert_text((48, 52), "Transport concepts")
    page.insert_text((48, 88), "Congestion control increases the congestion window carefully.")
    page.insert_text((242, 138), "ACK=100")
    page.insert_text((132, 226), "Transport Layer3-8")
    return document.tobytes()


def _visual_blocks_pdf_bytes() -> bytes:
    document = fitz.open()
    page = document.new_page(width=960, height=540)
    page.insert_text((160, 44), "3.7 TCP Congestion Control", fontsize=32)
    page.insert_text((182, 118), "sender sequence number space", fontsize=12)
    page.insert_text((298, 145), "cwnd", fontsize=10)
    page.insert_text((182, 235), "last byte\nACKed\nsent, not-yet\nACKed", fontsize=12)
    page.insert_text((160, 320), "❖ sender limits transmission:", fontsize=22)
    page.insert_text((208, 360), "LastByteSent-\nLastByteAcked", fontsize=14)
    page.insert_text((376, 366), "< cwnd", fontsize=14)
    page.insert_text((160, 430), "❖ cwnd is dynamic, function", fontsize=22)
    page.insert_text((187, 460), "of perceived network\ncongestion", fontsize=22)
    page.insert_text((534, 130), "TCP sending rate:", fontsize=22)
    page.insert_text((534, 170), "❖ roughly: send cwnd", fontsize=22)
    page.insert_text((561, 205), "bytes, wait RTT for\nACKS, then send\nmore bytes", fontsize=22)
    page.insert_text((560, 325), "rate ~= cwnd/RTT bytes/sec", fontsize=18)
    page.insert_text((645, 310), "cwnd\nRTT", fontsize=16)
    page.insert_text((702, 325), "bytes/sec", fontsize=16)
    page.insert_text((786, 520), "Transport Layer3-100", fontsize=10)
    return document.tobytes()


def _nested_indent_pdf_bytes() -> bytes:
    document = fitz.open()
    page = document.new_page(width=960, height=540)
    page.insert_text((64, 44), "Nested list layout", fontsize=32)
    page.insert_text((160, 130), "- loss indicated by timeout:", fontsize=22)
    page.insert_text((195, 168), "* cwnd set to 1 MSS;", fontsize=18)
    page.insert_text((195, 204), "* window grows exponentially to threshold", fontsize=18)
    page.insert_text((220, 232), "(ssthresh), then grows linearly", fontsize=18)
    page.insert_text((195, 268), "* when cwnd equals ssthresh, slow start ends", fontsize=18)
    page.insert_text((220, 296), "and congestion avoidance starts", fontsize=18)
    page.insert_text((160, 372), "- loss indicated by duplicate ACKs:", fontsize=22)
    page.insert_text((195, 410), "* cwnd is cut in half", fontsize=18)
    page.insert_text((790, 520), "Transport Layer3-103", fontsize=10)
    return document.tobytes()


def _indented_continuation_pdf_bytes() -> bytes:
    document = fitz.open()
    page = document.new_page(width=960, height=540)
    page.insert_text((64, 44), "Transport vs. network layer", fontsize=32)
    page.insert_text((150, 120), "household analogy:", fontsize=16)
    page.insert_text((150, 180), "12 kids in one house sending letters", fontsize=18)
    page.insert_text((150, 222), "- transport protocol demuxes", fontsize=18)
    page.insert_text((185, 252), "to in-house siblings", fontsize=18)
    page.insert_text((150, 304), "- network-layer protocol routes packets", fontsize=18)
    page.insert_text((650, 176), "short diagram label", fontsize=14)
    page.insert_text((790, 520), "Transport Layer3-8", fontsize=10)
    return document.tobytes()


class PdfParserTest(unittest.TestCase):
    def test_parse_pdf_bytes_extracts_page_text_and_text_metadata(self) -> None:
        result = parse_pdf_bytes(_simple_text_pdf_bytes())

        self.assertEqual(result.page_count, 1)
        self.assertEqual(len(result.pages), 1)
        page = result.pages[0]
        self.assertEqual(page.page_number, 1)
        self.assertIn("Chapter 1", page.text)
        self.assertIn("Multiplexing", page.text)
        self.assertGreaterEqual(page.text_block_count, 1)

        metadata = page.extraction_metadata()
        self.assertEqual(metadata["parser"], "pymupdf")
        self.assertEqual(metadata["pageNumber"], 1)
        self.assertGreaterEqual(metadata["textBlockCount"], 1)
        self.assertIn("elements", metadata)
        self.assertIn("textBlocks", metadata)
        self.assertEqual(metadata["extractionStrategy"], "pymupdf_visual_blocks_v3")
        self.assertEqual(metadata["readingOrderStrategy"], "visual_block_groups")
        self.assertIn("visualBlocks", metadata)
        self.assertTrue(any(element["type"] == "text" for element in metadata["elements"]))

    def test_parse_pdf_path_extracts_image_block_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            pdf_path = Path(temp_dir) / "image.pdf"
            pdf_path.write_bytes(_image_pdf_bytes())

            result = parse_pdf_path(pdf_path)

        page = result.pages[0]
        self.assertGreaterEqual(page.image_block_count, 1)
        image_elements = [element for element in page.elements if element.type == "image"]
        self.assertTrue(image_elements)
        self.assertIsNotNone(image_elements[0].bbox)
        self.assertEqual(image_elements[0].image_ext, "png")
        self.assertGreater(image_elements[0].width or 0, 0)
        self.assertGreater(image_elements[0].height or 0, 0)

    def test_invalid_pdf_raises_parsing_error(self) -> None:
        with self.assertRaises(PdfParsingError):
            parse_pdf_bytes(b"not a pdf")

    def test_layout_metadata_preserves_footer_and_side_label_candidates(self) -> None:
        result = parse_pdf_bytes(_layout_metadata_pdf_bytes())

        page = result.pages[0]
        self.assertIn("Congestion control", page.text)
        self.assertNotIn("Transport Layer3-8", page.text)
        self.assertIn("ACK=100", page.text)

        metadata = page.extraction_metadata()
        self.assertEqual(metadata["readingOrderStrategy"], "visual_block_groups")
        self.assertGreaterEqual(len(metadata["headerFooterCandidates"]), 1)
        self.assertGreaterEqual(len(metadata["sideLabelCandidates"]), 1)
        self.assertTrue(any(block.get("text") == "Transport Layer3-8" for block in metadata["textBlocks"]))
        self.assertTrue(any(block.get("text") == "ACK=100" for block in metadata["textBlocks"]))

    def test_visual_blocks_group_slide_regions(self) -> None:
        result = parse_pdf_bytes(_visual_blocks_pdf_bytes())

        page = result.pages[0]
        metadata = page.extraction_metadata()
        visual_blocks = metadata["visualBlocks"]

        self.assertNotIn("Transport Layer3-100", page.text)
        self.assertGreaterEqual(len(visual_blocks), 5)
        self.assertEqual(visual_blocks[0]["role"], "title")
        self.assertIn("3.7 TCP Congestion Control", visual_blocks[0]["text"])
        self.assertTrue(any(block["role"] == "figure" and "sender sequence number space" in block["text"] for block in visual_blocks))
        self.assertTrue(any(block["role"] == "content" and "sender limits transmission" in block["text"] for block in visual_blocks))
        self.assertTrue(any(block["role"] == "content" and "cwnd is dynamic" in block["text"] for block in visual_blocks))
        self.assertTrue(any(block["role"] == "content" and "TCP sending rate" in block["text"] for block in visual_blocks))

    def test_nested_indent_list_groups_child_items_without_bullet_specific_rules(self) -> None:
        result = parse_pdf_bytes(_nested_indent_pdf_bytes())

        page = result.pages[0]
        metadata = page.extraction_metadata()
        visual_blocks = metadata["visualBlocks"]
        content_blocks = [block["text"] for block in visual_blocks if block["role"] == "content"]

        self.assertGreaterEqual(len(content_blocks), 4)
        self.assertEqual(content_blocks[0], "- loss indicated by timeout:")
        self.assertIn("* cwnd set to 1 MSS;", content_blocks[1])
        self.assertIn("* window grows exponentially to threshold", content_blocks[1])
        self.assertIn("(ssthresh), then grows linearly", content_blocks[1])
        self.assertIn("* when cwnd equals ssthresh, slow start ends", content_blocks[1])
        self.assertIn("and congestion avoidance starts", content_blocks[1])
        self.assertEqual(content_blocks[2], "- loss indicated by duplicate ACKs:")
        self.assertIn("* cwnd is cut in half", content_blocks[3])

    def test_indented_continuation_stays_with_parent_item(self) -> None:
        result = parse_pdf_bytes(_indented_continuation_pdf_bytes())

        page = result.pages[0]
        metadata = page.extraction_metadata()
        visual_blocks = metadata["visualBlocks"]
        content_blocks = [block["text"] for block in visual_blocks if block["role"] == "content"]

        self.assertTrue(
            any(
                "- transport protocol demuxes\nto in-house siblings" in block
                for block in content_blocks
            )
        )
        self.assertFalse(any(block == "to in-house siblings" for block in content_blocks))
        self.assertNotIn("Transport Layer3-8", page.text)

    def test_block_aware_chunks_preserve_block_boundaries_and_metadata(self) -> None:
        blocks = [
            {
                "text": " ".join(["intro"] * 60),
                "role": "main_text",
                "readingOrder": 0,
                "blockIndex": 0,
                "bbox": [10, 10, 300, 40],
            },
            {
                "text": " ".join(["alpha"] * 100),
                "role": "main_text",
                "readingOrder": 1,
                "blockIndex": 1,
                "bbox": [10, 50, 300, 80],
            },
            {
                "text": "ACK=100",
                "role": "side_label_candidate",
                "readingOrder": 2,
                "blockIndex": 2,
                "bbox": [250, 120, 320, 140],
            },
            {
                "text": "Transport Layer3-9",
                "role": "header_footer_candidate",
                "readingOrder": 3,
                "blockIndex": 3,
                "bbox": [120, 224, 250, 238],
            },
        ]
        source = IndexSource(
            source_type="pdf_page",
            source_id="1",
            title="test",
            content="unused",
            user_id=1,
            metadata={
                "extraction_strategy": "pymupdf_layout_blocks_v2",
                "reading_order_strategy": "y_x_fallback",
                "header_footer_candidate_count": 1,
                "side_label_candidate_count": 1,
            },
            layout_blocks=blocks,
        )

        chunks = build_text_chunks(source)

        self.assertGreaterEqual(len(chunks), 2)
        self.assertTrue(chunks[0].content.startswith("intro"))
        self.assertFalse(chunks[1].content.startswith("tro"))
        self.assertTrue(any("[Figure labels]" in chunk.content for chunk in chunks))
        self.assertFalse(any("Transport Layer3-9" in chunk.content for chunk in chunks))
        self.assertEqual(chunks[0].metadata["chunking_strategy"], "block_aware_v2")
        self.assertIn("block_start_order", chunks[0].metadata)

    def test_block_aware_chunks_do_not_split_single_long_token(self) -> None:
        long_token = "x" * 900
        source = IndexSource(
            source_type="pdf_page",
            source_id="1",
            title="test",
            content=long_token,
            user_id=1,
            metadata={"extraction_strategy": "pymupdf_layout_blocks_v2"},
            layout_blocks=[
                {
                    "text": long_token,
                    "role": "main_text",
                    "readingOrder": 0,
                    "blockIndex": 0,
                    "bbox": [10, 10, 300, 40],
                }
            ],
        )

        chunks = build_text_chunks(source)

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].content, long_token)
        self.assertEqual(chunks[0].metadata["block_start_order"], 0)

    def test_block_overlap_does_not_start_next_chunk_mid_token(self) -> None:
        long_previous_token = "a" * 300
        source = IndexSource(
            source_type="pdf_page",
            source_id="1",
            title="test",
            content="unused",
            user_id=1,
            metadata={"extraction_strategy": "pymupdf_layout_blocks_v2"},
            layout_blocks=[
                {
                    "text": long_previous_token,
                    "role": "main_text",
                    "readingOrder": 0,
                    "blockIndex": 0,
                    "bbox": [10, 10, 300, 40],
                },
                {
                    "text": " ".join(["next"] * 130),
                    "role": "main_text",
                    "readingOrder": 1,
                    "blockIndex": 1,
                    "bbox": [10, 50, 300, 80],
                },
            ],
        )

        chunks = build_text_chunks(source)

        self.assertGreaterEqual(len(chunks), 2)
        self.assertTrue(chunks[1].content.startswith("next"))

    def test_page_state_preserves_rag_extraction_metadata(self) -> None:
        content = merge_page_state_content(
            None,
            None,
            pdf_text="PDF text",
            rag_extraction={
                "parser": "pymupdf",
                "textBlockCount": 1,
                "imageBlockCount": 0,
                "elements": [],
            },
        )

        updated = merge_page_state_content(
            content,
            '{"kind":"bsnap-page-state","version":1,"inkStrokes":[],"textAnnotations":[],"imageAnnotations":[]}',
        )
        state = parse_page_state(updated)

        self.assertIsNotNone(state)
        self.assertEqual(state["pdfText"], "PDF text")
        self.assertEqual(state["ragExtraction"]["parser"], "pymupdf")


class FakeUploadFile:
    def __init__(self, *, filename: str, content_type: str, data: bytes) -> None:
        self.filename = filename
        self.content_type = content_type
        self._data = data
        self._read = False
        self.closed = False

    async def read(self, _size: int) -> bytes:
        if self._read:
            return b""
        self._read = True
        return self._data

    async def close(self) -> None:
        self.closed = True


class PdfUploadTest(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_pdf_upload_is_removed_after_parse_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            settings = SimpleNamespace(
                upload_path=Path(temp_dir),
                upload_max_bytes=1024 * 1024,
            )
            file = FakeUploadFile(
                filename="broken.pdf",
                content_type="application/pdf",
                data=b"not a pdf",
            )

            with self.assertRaises(HTTPException):
                await _store_upload(file, settings, analyze_images=False)

            self.assertTrue(file.closed)
            self.assertEqual(list(Path(temp_dir).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
