use std::time::Duration;

use wasmtime_wasi::{HostMonotonicClock, HostWallClock, WasiCtxBuilder};

/// A WASI clock that always reads time 0, so a consumer's runtime never sees the real time.
pub struct ConstantClock;

impl HostWallClock for ConstantClock {
    fn resolution(&self) -> Duration {
        Duration::from_nanos(1)
    }

    fn now(&self) -> Duration {
        Duration::ZERO
    }
}

impl HostMonotonicClock for ConstantClock {
    fn resolution(&self) -> u64 {
        1
    }

    fn now(&self) -> u64 {
        0
    }
}

/// A WASI context with both clocks bound to [`ConstantClock`] and no stdio, environment, files or
/// network.
#[must_use]
pub fn build_context() -> WasiCtxBuilder {
    let mut builder = WasiCtxBuilder::new();
    builder
        .wall_clock(ConstantClock)
        .monotonic_clock(ConstantClock);
    builder
}
