# OCI Harness implementation contract

Implemented contract. Actual command outcomes and remaining verification boundaries are recorded in [acceptance evidence](../testing/evidence/2026-11-18-oci-harness.md); this design document is not test evidence.

New Harness registrations resolve an OCI image reference to a verified linux/amd64 manifest digest. A tenant owns immutable id/version registrations. Existing source packages remain readable/executable for pinned sessions, but the primary registration and Console path becomes images. Registry authentication is control-plane-only; raw registry credentials never enter the runtime environment or public responses.

A Session pins the image reference and protocol alongside the Harness reference. SandboxConnector receives the image at resource creation, not after provisioning. Connector capabilities explicitly advertise image execution; unsupported providers fail preflight before cloud operations. Initially implement native image launch in Modal, then expand only with actual provider evidence. Do not claim arbitrary OCI portability on template-only providers.

Runtime owns supervised Harness invocation, persisted output, cancellation and tool access. The image owns Harness binaries/dependencies; a thin adapter translates its CLI/protocol without reinstalling the Harness. Custom images default to the hexagon-json-v1 stdin/result contract; known CLI templates use explicit adapters. Default ENTRYPOINT/CMD come from the verified image configuration, with an explicit command override for custom protocol images. Platform bootstrap must not execute the image entrypoint in the control plane.

Built-in templates include pinned build recipes and protocol adapters. Image registration, template builds, deterministic contract tests and real cloud journeys are separate evidence categories. No image publication or commits are authorized. Public upstream images can be pulled and exercised; unpublished recipes must never appear as verified registry artifacts.

UI: Harness name, image/version, source, protocol, compatibility and actions in a real table; full digest and inspection details belong in a drawer/dialog. Primary action registers an image; SDK examples use the same API. Remove duplicate page-title/header layers; one contextual toolbar contains page actions, language and navigation context.
