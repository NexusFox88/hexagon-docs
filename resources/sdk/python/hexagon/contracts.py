"""Public compatibility metadata; readiness is not a cloud acceptance claim."""
from typing import Dict, List, Literal, TypedDict


class Compatibility(TypedDict):
    status: Literal['supported', 'unsupported']
    reasons: List[str]


class Verification(TypedDict):
    status: Literal['unverified']
    evidence: List[str]


class Requirements(TypedDict):
    sandbox_capabilities: List[str]
    tool_capabilities: List[List[str]]


class Combination(TypedDict):
    schema_version: Literal[1]
    requirements: Requirements
    compatibility: Compatibility
    capabilities: List[str]
    verification: Verification


class Readiness(TypedDict):
    status: Literal['ready']
    checked_at: str


class Lifecycle(TypedDict):
    mode: str
    preservation: str
    automatic_wake: bool
    idle_timeout_seconds: int


class CredentialBoundary(TypedDict):
    implementation: str
    raw_secret_in_sandbox: bool
    delegated_token_in_sandbox: bool


class SessionPreflight(TypedDict):
    ready: bool
    readiness: Readiness
    combination: Combination
    lifecycle: Lifecycle
    connections: Dict[str, CredentialBoundary]
