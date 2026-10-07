# Front-end performance reading note

Performance is part of correctness when a workflow is used on a busy campus network or a mobile device.

## A practical review order

1. Measure the initial render and the first meaningful interaction on a representative device.
2. Separate network delay, JavaScript work, rendering work, and server latency.
3. Check loading, empty, error, retry, and offline-adjacent states together; a fast success path is not enough.
4. Verify keyboard navigation, focus recovery after errors, contrast, and reduced-motion behaviour.

## Useful evidence

Keep a small table for each change: build size, interaction latency, error recovery path, device/network assumption, and date measured. The table gives future readers a way to distinguish a measured improvement from an implementation preference.

## Trade-offs

Avoid optimisations that hide important status information or make the code harder to inspect. Prefer explicit state, small modules, stable contracts, and progressive disclosure before adding a dependency or complex cache.
