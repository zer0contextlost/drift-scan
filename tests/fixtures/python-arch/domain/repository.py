from domain.user import User


class UserRepository:
    def find_by_id(self, user_id: str) -> User:
        raise NotImplementedError
