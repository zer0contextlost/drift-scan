package domain

// VIOLATION: domain imports infra
import "example.com/myapp/internal/infra"

type OrderService struct {
	repo *infra.PostgresRepo
}
