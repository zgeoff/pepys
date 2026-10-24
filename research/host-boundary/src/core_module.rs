use std::collections::HashMap;
use std::time::Instant;

use wasmtime::{Caller, Engine, Extern, Instance, Linker, Memory, Module, Store};
use wasmtime_wasi::p1::{self, WasiP1Ctx};

use crate::rows::Split;
use crate::{BoundaryError, ReadShape, RunTiming, clock};

struct Host {
    wasi: WasiP1Ctx,
    rows: HashMap<String, Vec<u8>>,
}

/// Instantiates the scriptc reactor, passes the input through its exported memory, and reads the
/// operations back from the two out-slots scriptc writes.
pub fn run(
    engine: &Engine,
    module: &Module,
    split: &Split,
    reads: ReadShape,
) -> Result<(String, RunTiming), BoundaryError> {
    let start = Instant::now();
    let host = Host {
        wasi: clock::build_context().build_p1(),
        rows: split.rows.clone(),
    };
    let mut store = Store::new(engine, host);
    let mut linker: Linker<Host> = Linker::new(engine);

    p1::add_to_linker_sync(&mut linker, |host| &mut host.wasi)?;
    linker.func_wrap("scriptc", "readReviewLength", read_review_length)?;
    linker.func_wrap("scriptc", "readReviewInto", read_review_into)?;
    linker.func_wrap("scriptc", "panic", panic)?;

    let instance = linker.instantiate(&mut store, module)?;
    instance
        .get_typed_func::<(), ()>(&mut store, "_initialize")?
        .call(&mut store, ())?;
    instance
        .get_typed_func::<(), ()>(&mut store, "review_links_init")?
        .call(&mut store, ())?;
    let instantiate_micros = start.elapsed().as_micros();

    let call_start = Instant::now();
    let export = match reads {
        ReadShape::Prefetch => "review_links_from_input",
        ReadShape::Reads => "review_links_with_reads",
    };
    let output = call_string_export(&mut store, &instance, export, &split.input)?;
    let call_micros = call_start.elapsed().as_micros();

    Ok((
        output,
        RunTiming {
            instantiate_micros,
            call_micros,
        },
    ))
}

fn call_string_export(
    store: &mut Store<Host>,
    instance: &Instance,
    export: &str,
    input: &str,
) -> Result<String, BoundaryError> {
    let memory = instance
        .get_memory(&mut *store, "memory")
        .ok_or(BoundaryError::MissingExport("memory"))?;
    let alloc = instance.get_typed_func::<i32, i32>(&mut *store, "scriptc_alloc")?;
    let derive = instance.get_typed_func::<(i32, i32, i32, i32), ()>(&mut *store, export)?;

    let length = i32::try_from(input.len()).map_err(|_| BoundaryError::OutOfBounds)?;
    let input_pointer = alloc.call(&mut *store, length)?;
    memory
        .write(&mut *store, to_offset(input_pointer)?, input.as_bytes())
        .map_err(|_| BoundaryError::OutOfBounds)?;
    let slots = alloc.call(&mut *store, 8)?;

    derive.call(&mut *store, (input_pointer, length, slots, slots + 4))?;

    let mut slot_bytes = [0_u8; 8];
    memory
        .read(&*store, to_offset(slots)?, &mut slot_bytes)
        .map_err(|_| BoundaryError::OutOfBounds)?;
    let [p0, p1, p2, p3, l0, l1, l2, l3] = slot_bytes;
    let result_pointer = u32::from_le_bytes([p0, p1, p2, p3]) as usize;
    let result_length = u32::from_le_bytes([l0, l1, l2, l3]) as usize;
    let bytes = memory
        .data(&*store)
        .get(result_pointer..result_pointer + result_length)
        .ok_or(BoundaryError::OutOfBounds)?;

    String::from_utf8(bytes.to_vec()).map_err(|_| BoundaryError::OutOfBounds)
}

fn to_offset(pointer: i32) -> Result<usize, BoundaryError> {
    usize::try_from(pointer).map_err(|_| BoundaryError::OutOfBounds)
}

fn caller_memory(caller: &mut Caller<'_, Host>) -> wasmtime::Result<Memory> {
    match caller.get_export("memory") {
        Some(Extern::Memory(memory)) => Ok(memory),
        _ => Err(wasmtime::Error::msg("the consumer exports no memory")),
    }
}

fn read_key(caller: &mut Caller<'_, Host>, pointer: i32, length: i32) -> wasmtime::Result<String> {
    let memory = caller_memory(caller)?;
    let start = usize::try_from(pointer)?;
    let end = start + usize::try_from(length)?;
    let bytes = memory
        .data(&*caller)
        .get(start..end)
        .ok_or_else(|| wasmtime::Error::msg("key out of bounds"))?;
    Ok(String::from_utf8(bytes.to_vec())?)
}

fn read_review_length(
    mut caller: Caller<'_, Host>,
    pointer: i32,
    length: i32,
) -> wasmtime::Result<f64> {
    let key = read_key(&mut caller, pointer, length)?;
    Ok(caller.data().rows.get(&key).map_or(-1.0, |row| {
        f64::from(u32::try_from(row.len()).unwrap_or(u32::MAX))
    }))
}

fn read_review_into(
    mut caller: Caller<'_, Host>,
    key_pointer: i32,
    key_length: i32,
    row_pointer: i32,
    row_length: i32,
) -> wasmtime::Result<()> {
    let key = read_key(&mut caller, key_pointer, key_length)?;
    let Some(row) = caller.data().rows.get(&key).cloned() else {
        return Ok(());
    };
    let capacity = usize::try_from(row_length)?;
    let memory = caller_memory(&mut caller)?;
    memory.write(
        &mut caller,
        usize::try_from(row_pointer)?,
        &row[..row.len().min(capacity)],
    )?;
    Ok(())
}

fn panic(mut caller: Caller<'_, Host>, pointer: i32, length: i32) -> wasmtime::Result<()> {
    let message = read_key(&mut caller, pointer, length).unwrap_or_default();
    Err(wasmtime::Error::msg(format!(
        "the consumer panicked: {message}"
    )))
}
