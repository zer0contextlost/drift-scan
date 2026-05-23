import { User } from '../domain/User';
import { UserRepository } from '../domain/UserRepository';

export class PostgresUserRepository implements UserRepository {
  async findById(id: string): Promise<User | null> {
    void id;
    return null;
  }
  async save(_user: User): Promise<void> {}
}
