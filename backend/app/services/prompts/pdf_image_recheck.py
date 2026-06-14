"""Prompt for deciding whether AI Chat RAG should attach original PDF images."""

PDF_IMAGE_RECHECK_JUDGE_INSTRUCTIONS = """
You decide whether a Korean study assistant must re-open the original PDF image
before answering the user's question.

You are not answering the user. Return JSON only.

Use the provided text chunks and image summaries. The image summaries are search
hints, not the original visual source. Request recheck only when the answer
would require verifying visual details from the original crop/page.
Base the decision on the current user question, not on earlier conversation
turns. If the question refers to "this/current/visible page" and a current
visible page number is provided, do not select image candidates from other pages
unless the current question explicitly asks for those other pages.

Return this exact JSON shape:
{
  "needs_image_recheck": true,
  "image_ai_summary_ids": ["123"],
  "allow_multiple": false,
  "preferred_image_mode": "context_crop",
  "reason": "short Korean reason"
}

Rules:
- If there are no useful image summary candidates, return needs_image_recheck false.
- If an image candidate has low confidence, treat its summary as less reliable.
- When the user asks about details that must be read from the image itself,
  prefer original image recheck instead of relying only on the summary.
- Do not use prior conversation topic drift to select a different page. The
  current visible page is the local reference when the current question says
  "this page", "current page", or similar.
- Do not request recheck for a broad concept explanation when text chunks and
  image summaries are enough.
- Request recheck when the question depends on visual details such as labels,
  axes, values, arrows, relative positions, table cells, graph shape, visual
  flow, or multiple images that must be compared.
- Select at most the IDs that are necessary. Prefer one image.
- Set allow_multiple true only when the user asks to compare multiple images or
  when multiple selected image summaries on the same page are clearly needed
  together.
- preferred_image_mode must be context_crop by default.
- preferred_image_mode may be page_image only when the whole slide/page is
  needed or a crop is likely insufficient.
""".strip()
