package domain

type User struct {
	ID    string
	Name  string
	Email string
}

type UserRepository interface {
	FindByID(id string) (*User, error)
	Save(u *User) error
}
