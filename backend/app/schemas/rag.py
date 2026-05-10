from pydantic import BaseModel, Field


class RetrievedContext(BaseModel):
    source_type: str
    source_id: str
    title: str
    content: str
    score: float = 0.0


class NoteSummarySection(BaseModel):
    title: str
    body: str
    tone: str = "default"


class QuizQuestion(BaseModel):
    question: str
    answer: str
    explanation: str
    type: str = "short_answer"


class RAGAnswer(BaseModel):
    answer: str
    sections: list[NoteSummarySection] = Field(default_factory=list)
    sources: list[RetrievedContext] = Field(default_factory=list)


class RAGAskRequest(BaseModel):
    question: str
    subject_id: int | None = None
    folder_id: int | None = None
    note_ids: list[int] | None = None
    top_k: int = Field(default=5, ge=1, le=20)
    model: str | None = None


class RAGSummaryRequest(BaseModel):
    note_ids: list[int] | None = None
    subject_id: int | None = None
    folder_id: int | None = None
    top_k: int = Field(default=5, ge=1, le=20)
    mode: str = "note"
    model: str | None = None


class RAGQuizRequest(BaseModel):
    note_ids: list[int] | None = None
    subject_id: int | None = None
    folder_id: int | None = None
    top_k: int = Field(default=5, ge=1, le=20)
    count: int = Field(default=5, ge=1, le=20)
    model: str | None = None


class RAGQuizResponse(BaseModel):
    questions: list[QuizQuestion]
    sources: list[RetrievedContext] = Field(default_factory=list)
