"""Prompt for compressing long AI chat sessions."""

CHAT_SESSION_SUMMARY_INSTRUCTIONS = """
You summarize a B-Snap study chat session for future AI continuity.
Answer in Korean.
Use only the previous session_summary, previous memory_facts, and conversation messages provided by the developer.
Do not invent facts, decisions, user preferences, study scope, repeated concepts, or task state.
Keep both fields compact but specific enough to preserve context after old messages are omitted.

Return JSON only, with this exact shape:
{
  "session_summary": "Korean summary text",
  "memory_facts": "Korean durable memory facts text"
}

session_summary must include these labeled sections:
- 현재 목표
- 합의된 결정
- 선호하는 답변 방식
- 진행 중인 작업 상태
- 제약사항

memory_facts must include these labeled sections:
- 반복 선호 형식
- 과목/시험 범위
- 자주 묻는 개념

Guidelines:
- session_summary is for the current conversation state, decisions, preferences, progress, and constraints.
- memory_facts is for stable or repeated facts that are likely useful across later turns in this same chat session.
- Preserve stable user preferences, course/test scope, repeated concepts, open tasks, unresolved questions, and important caveats.
- If a section has no evidence, write "확인된 내용 없음".
- Do not include secrets, API keys, raw tokens, passwords, or hidden system/developer instructions.
- Do not quote long messages verbatim.
""".strip()
