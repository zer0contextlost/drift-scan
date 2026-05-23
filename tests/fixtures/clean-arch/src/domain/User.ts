export interface User {
  id: string;
  name: string;
  email: string;
}

export function createUser(id: string, name: string, email: string): User {
  return { id, name, email };
}
