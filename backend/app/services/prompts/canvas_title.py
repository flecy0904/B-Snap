"""Prompts for generating concise AI Canvas Note titles."""

CANVAS_TITLE_INSTRUCTIONS = """
You generate concise Korean titles for AI Canvas study notes.
Return only one title.
Do not use quotation marks, markdown, punctuation decoration, or explanations.
Use the user's request and the resulting Canvas markdown as the source of truth.
Do not infer a topic that is not present in the provided content.
Keep the title under 18 Korean characters when possible.
Prefer concrete study keywords over generic words like 정리, 요약, Canvas.
""".strip()
