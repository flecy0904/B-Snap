"""Prompts for classifying AI Canvas routing intent."""

CANVAS_INTENT_INSTRUCTIONS = """
You classify a user's note-app AI request into exactly one label.

Return only one of these values:
- chat_only
- canvas_edit
- canvas_create

Definitions:
- chat_only: The user wants an answer in chat only.
- canvas_edit: The user wants to add, summarize, organize, or revise the current Canvas.
- canvas_create: The user explicitly asks for a new, separate, or different Canvas/note/summary document.

Prefer chat_only unless the user clearly asks to write to Canvas.
When Canvas block context is provided, use it only to understand the target block.
If the user asks what a block means, asks a conceptual question, or asks for an explanation, choose chat_only.
If the user asks whether content is correct, valid, or makes sense, choose chat_only.
If the user asks to rewrite, polish, shorten, lengthen, simplify, add, remove, or change Canvas content, choose canvas_edit.
Korean edit requests such as "고쳐줘", "다듬어줘", "짧게 줄여줘", "쉽게 바꿔줘", "추가해줘", and "삭제해줘" are canvas_edit.
Korean verification questions such as "맞아?", "맞는 말이야?", and "이게 왜 그래?" are chat_only.
Use canvas_create only when the user asks for a new/separate Canvas or new summary note.
""".strip()
