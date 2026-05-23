# VIOLATION: domain imports infra directly
from infra.db import get_connection
from domain.user import User


def save_user(user: User) -> None:
    conn = get_connection()
    print(f"saving {user.name} to {conn}")
