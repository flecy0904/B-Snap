from psycopg import Connection

from backend.app.db.session import get_database_url


def main() -> None:
    with Connection.connect(get_database_url()) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            result = cursor.fetchone()
            print({"status": "ok", "result": result})


if __name__ == "__main__":
    main()
