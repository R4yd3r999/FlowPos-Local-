"""Excepciones de dominio. Se traducen a códigos HTTP en main.py."""


class DomainError(Exception):
    """Base de todas las excepciones de negocio."""
    status_code = 400


class NotFoundError(DomainError):
    status_code = 404


class ConflictError(DomainError):
    status_code = 409


class InsufficientStockError(DomainError):
    status_code = 409


class ValidationDomainError(DomainError):
    status_code = 422


class AuthError(DomainError):
    status_code = 401
