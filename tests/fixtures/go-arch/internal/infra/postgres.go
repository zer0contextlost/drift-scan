package infra

import "example.com/myapp/internal/domain"

type PostgresRepo struct{}

func (r *PostgresRepo) FindByID(id string) (*domain.User, error) {
	return &domain.User{ID: id}, nil
}

func (r *PostgresRepo) Save(u *domain.User) error {
	return nil
}
