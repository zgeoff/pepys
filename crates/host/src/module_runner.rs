use std::fmt::Write;
use std::path::Path;
use std::sync::Arc;

use sha2::{Digest, Sha256};
use wasmtime::{Caller, Engine, Extern, Instance, Linker, Memory, Module, Store};
use wasmtime_wasi::p1::{self, WasiP1Ctx};

use crate::batch::FactRunner;
use crate::clock;
use crate::consumer::ConsumerSpec;
use crate::error::HostError;

/// Serves the consumer's row reads. The host answers a read with the JSON of the stored row.
pub trait RowSource: Send + Sync {
    /// # Errors
    /// Fails when the row cannot be read.
    fn read_row(&self, key: &str) -> Result<Option<Vec<u8>>, HostError>;
}

struct Host {
    wasi: WasiP1Ctx,
    rows: Arc<dyn RowSource>,
}

/// A consumer module compiled once and instantiated for each fact.
pub struct ModuleRunner {
    engine: Engine,
    module: Module,
    spec: &'static ConsumerSpec,
}

/// The SHA-256 of a module's bytes in lowercase hexadecimal, which names its version.
#[must_use]
pub fn hash_module(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .fold(String::new(), |mut hex, byte| {
            let _ = write!(hex, "{byte:02x}");
            hex
        })
}

impl ModuleRunner {
    /// # Errors
    /// Fails when the bytes are not a valid module.
    pub fn new(bytes: &[u8], spec: &'static ConsumerSpec) -> Result<Self, HostError> {
        let engine = Engine::default();
        let module = Module::new(&engine, bytes)?;

        Ok(Self {
            engine,
            module,
            spec,
        })
    }

    /// # Errors
    /// Fails when the file cannot be read or is not a valid module.
    pub fn from_file(
        path: &Path,
        spec: &'static ConsumerSpec,
    ) -> Result<(Self, String), HostError> {
        let bytes = std::fs::read(path)?;
        let hash = hash_module(&bytes);

        Ok((Self::new(&bytes, spec)?, hash))
    }

    fn instantiate(&self, rows: Arc<dyn RowSource>) -> Result<(Store<Host>, Instance), HostError> {
        let host = Host {
            wasi: clock::build_context().build_p1(),
            rows,
        };
        let mut store = Store::new(&self.engine, host);
        let mut linker: Linker<Host> = Linker::new(&self.engine);

        p1::add_to_linker_sync(&mut linker, |host| &mut host.wasi)?;

        for read in self.spec.reads {
            linker.func_wrap("scriptc", read.length, read_row_length)?;
            linker.func_wrap("scriptc", read.into, read_row_into)?;
        }

        linker.func_wrap("scriptc", "panic", panic)?;

        let instance = linker.instantiate(&mut store, &self.module)?;

        instance
            .get_typed_func::<(), ()>(&mut store, "_initialize")?
            .call(&mut store, ())?;
        instance
            .get_typed_func::<(), ()>(&mut store, &format!("{}_init", self.spec.name))?
            .call(&mut store, ())?;

        Ok((store, instance))
    }
}

impl FactRunner for ModuleRunner {
    fn apply_fact(&mut self, fact: &str, rows: Arc<dyn RowSource>) -> Result<String, HostError> {
        let (mut store, instance) = self.instantiate(rows)?;
        let export = format!("{}_apply_fact", self.spec.name);

        call_string_export(&mut store, &instance, &export, fact)
    }
}

fn call_string_export(
    store: &mut Store<Host>,
    instance: &Instance,
    export: &str,
    input: &str,
) -> Result<String, HostError> {
    let memory = instance
        .get_memory(&mut *store, "memory")
        .ok_or_else(|| HostError::MissingExport("memory".to_owned()))?;
    let alloc = instance.get_typed_func::<i32, i32>(&mut *store, "scriptc_alloc")?;
    let apply = instance.get_typed_func::<(i32, i32, i32, i32), ()>(&mut *store, export)?;

    let length = i32::try_from(input.len()).map_err(|_| HostError::OutOfBounds)?;
    let input_pointer = alloc.call(&mut *store, length)?;

    memory
        .write(&mut *store, to_offset(input_pointer)?, input.as_bytes())
        .map_err(|_| HostError::OutOfBounds)?;

    let slots = alloc.call(&mut *store, 8)?;

    apply.call(&mut *store, (input_pointer, length, slots, slots + 4))?;

    let mut slot_bytes = [0_u8; 8];

    memory
        .read(&*store, to_offset(slots)?, &mut slot_bytes)
        .map_err(|_| HostError::OutOfBounds)?;

    let [p0, p1, p2, p3, l0, l1, l2, l3] = slot_bytes;
    let result_pointer = u32::from_le_bytes([p0, p1, p2, p3]) as usize;
    let result_length = u32::from_le_bytes([l0, l1, l2, l3]) as usize;
    let bytes = memory
        .data(&*store)
        .get(result_pointer..result_pointer + result_length)
        .ok_or(HostError::OutOfBounds)?;

    String::from_utf8(bytes.to_vec()).map_err(|_| HostError::OutOfBounds)
}

fn to_offset(pointer: i32) -> Result<usize, HostError> {
    usize::try_from(pointer).map_err(|_| HostError::OutOfBounds)
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

fn read_stored(
    caller: &mut Caller<'_, Host>,
    pointer: i32,
    length: i32,
) -> wasmtime::Result<Option<Vec<u8>>> {
    let key = read_key(caller, pointer, length)?;

    caller
        .data()
        .rows
        .read_row(&key)
        .map_err(|error| wasmtime::Error::msg(error.to_string()))
}

fn read_row_length(
    mut caller: Caller<'_, Host>,
    pointer: i32,
    length: i32,
) -> wasmtime::Result<f64> {
    Ok(
        read_stored(&mut caller, pointer, length)?.map_or(-1.0, |row| {
            f64::from(u32::try_from(row.len()).unwrap_or(u32::MAX))
        }),
    )
}

fn read_row_into(
    mut caller: Caller<'_, Host>,
    key_pointer: i32,
    key_length: i32,
    row_pointer: i32,
    row_length: i32,
) -> wasmtime::Result<()> {
    let Some(row) = read_stored(&mut caller, key_pointer, key_length)? else {
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

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::hash_module;

    #[test]
    fn it_hashes_a_module_with_sha256() {
        assert_eq!(
            hash_module(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
