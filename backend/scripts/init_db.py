from sqlalchemy import create_engine

from backend.app.core.config import get_settings
from backend.app.db.base import Base
from backend.app import models


def main() -> None:
    engine = create_engine(get_settings().database_url)
    Base.metadata.create_all(bind=engine)
    print({"status": "ok", "tables": sorted(Base.metadata.tables.keys())})


if __name__ == "__main__":
    main()
