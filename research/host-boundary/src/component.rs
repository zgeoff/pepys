use std::collections::HashMap;
use std::time::Instant;

use wasmtime::component::{Component, HasSelf, Linker, ResourceTable};
use wasmtime::{Engine, Store};
use wasmtime_wasi::{WasiCtx, WasiCtxView, WasiView};

use crate::rows::Split;
use crate::{BoundaryError, ReadShape, RunTiming, clock};

wasmtime::component::bindgen!({
    path: "wit/review-links.wit",
    world: "review-links",
});

struct Host {
    wasi: WasiCtx,
    table: ResourceTable,
    rows: HashMap<String, Vec<u8>>,
    panic_message: Option<String>,
}

impl WasiView for Host {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.table,
        }
    }
}

impl pepys::boundary::reads::Host for Host {
    fn read_review_length(&mut self, review_id: String) -> f64 {
        self.rows.get(&review_id).map_or(-1.0, |row| {
            f64::from(u32::try_from(row.len()).unwrap_or(u32::MAX))
        })
    }

    // The canonical ABI hands the host a copy of the row buffer, so nothing written here reaches
    // the consumer's memory.
    fn read_review_into(&mut self, review_id: String, mut row: Vec<u8>) {
        if let Some(stored) = self.rows.get(&review_id) {
            let length = row.len().min(stored.len());
            row[..length].copy_from_slice(&stored[..length]);
        }
    }

    fn panic(&mut self, message: String) {
        self.panic_message = Some(message);
    }
}

/// Instantiates the wrapped consumer and calls its WIT export with bindings that `bindgen!`
/// generates from the world.
pub fn run(
    engine: &Engine,
    component: &Component,
    split: &Split,
    reads: ReadShape,
) -> Result<(String, RunTiming), BoundaryError> {
    let start = Instant::now();
    let host = Host {
        wasi: clock::build_context().build(),
        table: ResourceTable::new(),
        rows: split.rows.clone(),
        panic_message: None,
    };
    let mut store = Store::new(engine, host);
    let mut linker: Linker<Host> = Linker::new(engine);

    wasmtime_wasi::p2::add_to_linker_sync(&mut linker)?;
    pepys::boundary::reads::add_to_linker::<Host, HasSelf<Host>>(&mut linker, |host| host)?;

    let bindings = ReviewLinks::instantiate(&mut store, component, &linker)?;
    let instantiate_micros = start.elapsed().as_micros();

    let call_start = Instant::now();
    let links = bindings.pepys_boundary_links();
    let output = match reads {
        ReadShape::Prefetch => links.call_derive_from_input(&mut store, &split.input),
        ReadShape::Reads => links.call_derive_with_reads(&mut store, &split.input),
    };
    let output = match (output, store.data_mut().panic_message.take()) {
        (Ok(output), _) => output,
        (Err(_), Some(message)) => return Err(BoundaryError::Panicked(message)),
        (Err(error), None) => return Err(error.into()),
    };
    let call_micros = call_start.elapsed().as_micros();

    Ok((
        output,
        RunTiming {
            instantiate_micros,
            call_micros,
        },
    ))
}
