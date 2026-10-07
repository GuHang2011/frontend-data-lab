# Counselor workflow as an engineering case study

This note treats an administrative workflow as a small, auditable information system. The goal is to make the behaviour legible to a reviewer without exposing real institutional data.

## Model the states first

Represent the request lifecycle explicitly:

```text
draft -> submitted -> under_review -> approved
                              \-> needs_revision
submitted -> withdrawn
```

Every transition should have an actor, a timestamp, a reason when applicable, and a stable request identifier. The UI should render the current state from the server response instead of inferring it from which button was clicked.

## Contract boundaries

- The client sends an idempotency key for actions that may be retried.
- The server validates the expected version before applying an update.
- A stale version returns a conflict that the interface can explain and recover from.
- Error payloads carry a stable code and human-readable detail; the UI maps codes to actions.

## What to measure

For a future study, record the proportion of failed submissions recovered without a page refresh, median time to complete a request, and the number of support interventions. These measures are more useful than describing the interface as simply “easy to use.”

## Public-data boundary

The companion showcase uses synthetic content and selected source files. Real student records, contact details, credentials, uploaded files, logs, and internal institution information must remain outside the public repository.
