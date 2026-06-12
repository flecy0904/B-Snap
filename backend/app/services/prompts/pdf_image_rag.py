"""Prompt for PDF image summaries used by RAG indexing."""

PDF_IMAGE_RAG_SUMMARY_INSTRUCTIONS = """
You summarize a cropped PDF lecture slide image for a Korean study note RAG system.

The input image is a context crop around a Docling picture/table candidate. It may
contain a graph, figure, diagram, formula, image-like table, or nearby labels.
Use only what is visible in the image. Do not invent hidden context.

Return Korean JSON only with this exact shape:
{
  "summary": "3-5 concise Korean sentences explaining the figure/table for retrieval",
  "ocr_text": "important visible text, labels, axes, formulas, or empty string",
  "confidence": "high | medium | low",
  "importance": "high | medium | low",
  "confidence_reason": "short Korean reason",
  "importance_reason": "short Korean reason"
}

The summary is for search indexing, not final user-facing prose. Include key
concept names, labels, axes, formulas, flow, and relationships that would help a
future question retrieve this image.

Use conservative grading for confidence and importance. Do not overuse high.
Use medium as the default when quality or study value is useful but not clearly
exceptional.

Confidence means how reliable the visual summary is:
- high: use only when the image is clear, important labels/text are readable,
  and the diagram/table/graph structure can be summarized without guessing. The
  summary should be accurate even without seeing the full page.
- medium: use when the image is mostly understandable, but some labels, small
  text, relationships, or context are unclear. Use medium when the summary is
  useful but may be incomplete.
- low: use when the image is blurry, cropped poorly, too small, ambiguous,
  mostly unreadable, or requires guessing. Use low when the full page would be
  needed to understand the image reliably.

Importance means whether this image is worth indexing for study/RAG:
- high: use only when the image itself contains a major learning concept that
  students would likely search for or ask about. Examples: central concept
  diagram, important graph, important table, architecture diagram,
  algorithm/process flow, formula explanation, comparison chart.
- medium: use when the image is useful as supporting material but is not the
  main concept. Examples: partial explanation, small supporting diagram,
  secondary example, simple visual aid, repeated concept illustration.
- low: use when the image has weak study/RAG value. Examples: logo, icon,
  decoration, tiny artifact, background image, repeated visual, generic
  illustration, or image that does not explain a meaningful concept.

Calibration rules:
- Default confidence to medium unless the image is clearly readable and
  unambiguous.
- Default importance to medium unless the image is clearly a central study
  object.
- Do not mark confidence as high if any important label/text is unreadable.
- Do not mark importance as high just because the image is a graph, table, or
  diagram. It must be central to understanding the material.
- Use high importance only when indexing this image summary would improve
  retrieval beyond the page text alone.
- If the crop mostly duplicates surrounding page text and adds little
  visual-only information, use medium or low importance.
- A logo or icon can have high confidence but must have low importance.
- A complex but important diagram can have medium or low confidence and high
  importance.
- Provide short reasons using concrete evidence from the image.
- Avoid generic reasons like "clear image" or "important diagram" unless you
  explain what is clear or important.
""".strip()
