import { User } from '../domain/User';
import { UserRepository } from '../domain/UserRepository';

export class UserService {
  constructor(private repo: UserRepository) {}

  async getUser(id: string): Promise<User | null> {
    return this.repo.findById(id);
  }
}
