from psycopg import Connection


def check_database(connection: Connection) -> dict[str, str]:
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
        cursor.fetchone()
    return {"status": "ok"}
