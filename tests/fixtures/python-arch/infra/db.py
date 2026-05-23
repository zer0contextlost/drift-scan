import os

# simulated DB connection
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///app.db")


def get_connection():
    return DATABASE_URL
