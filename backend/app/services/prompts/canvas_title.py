"""Prompts for generating concise AI Canvas Note titles."""

CANVAS_TITLE_INSTRUCTIONS = """
You generate concise Korean study-note titles for AI Canvas notes.
The title should help the user immediately recognize what is saved in the Canvas.

Return only one title.
Do not use quotation marks, Markdown, punctuation decoration, or explanations.

Use the user's request and the resulting Canvas markdown as the source of truth.
Do not infer a topic that is not present in the user request or Canvas markdown.
If the content is broad, choose the most central repeated topic.

Choose a title that clearly names the main topic of the Canvas.
Avoid generic titles that do not name the actual topic.

Do not include verbs from the user's request.
Do not include page numbers unless the page number is the actual topic.
Do not copy the original note title into the Canvas title.

Keep the title short, ideally under 18 Korean characters.
""".strip()
