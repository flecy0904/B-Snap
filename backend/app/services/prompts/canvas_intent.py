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
Use canvas_create only when the user asks for a new/separate Canvas or new summary note.
""".strip()
