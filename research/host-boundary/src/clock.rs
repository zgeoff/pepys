use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use wasmtime_wasi::{HostMonotonicClock, HostWallClock, WasiCtxBuilder};

/// Counts every clock read, so the runner can show the consumer's runtime reads the bound clock.
pub static READS: AtomicU64 = AtomicU64::new(0);

/// A WASI clock that always reads time 0, so a consumer's runtime never sees the real time.
pub struct ConstantClock;

impl HostWallClock for ConstantClock {
    fn resolution(&self) -> Duration {
        Duration::from_nanos(1)
    }

    fn now(&self) -> Duration {
        READS.fetch_add(1, Ordering::Relaxed);
        Duration::ZERO
    }
}

impl HostMonotonicClock for ConstantClock {
    fn resolution(&self) -> u64 {
        1
    }

    fn now(&self) -> u64 {
        READS.fetch_add(1, Ordering::Relaxed);
        0
    }
}

/// A WASI context with both clocks bound to [`ConstantClock`] and no stdio, environment, files or
/// network.
pub fn build_context() -> WasiCtxBuilder {
    let mut builder = WasiCtxBuilder::new();
    builder
        .wall_clock(ConstantClock)
        .monotonic_clock(ConstantClock);
    builder
}
