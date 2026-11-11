use std::fmt::Write;
use std::sync::Arc;

use sha2::{Digest, Sha256};
use wasmtime::{Caller, Engine, Extern, Instance, Linker, Memory, Module, Store};
use wasmtime_wasi::p1::{self, WasiP1Ctx};

use crate::batch::FactRunner;
use crate::clock;
use crate::consumer::{ConsumerManifest, Read};
use crate::error::HostError;
use crate::scope::{FactSource, ScopeRunner};

/// Serves the consumer's row reads. The host answers a read with the JSON of the stored row.
pub trait RowSource: Send + Sync {
    /// Reads the row of `table` whose key the module passed as `argument`.
    ///
    /// # Errors
    /// Fails when the row cannot be read.
    fn read_row(&self, table: &str, argument: &str) -> Result<Option<Vec<u8>>, HostError>;
}

/// What the module's reads reach: a fact consumer's rows, or the facts of the scope it was called
/// for.
enum Reads {
    Rows(Arc<dyn RowSource>),
    ScopeFacts(Arc<dyn FactSource>),
}

/// The one read of a manifest import.
#[derive(Clone)]
enum ReadTarget {
    Row(String),
    ScopeFacts,
}

struct Host {
    wasi: WasiP1Ctx,
    reads: Reads,
    // The first refusal of a read, kept whole: a host function can hand wasmtime only a message.
    refusal: Option<HostError>,
}

/// A consumer module compiled once and instantiated for each fact, linked by the symbols its
/// manifest names.
pub struct ModuleRunner {
    engine: Engine,
    module: Module,
    manifest: Arc<ConsumerManifest>,
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
    pub fn new(bytes: &[u8], manifest: Arc<ConsumerManifest>) -> Result<Self, HostError> {
        let engine = Engine::default();
        let module = Module::new(&engine, bytes)?;

        Ok(Self {
            engine,
            module,
            manifest,
        })
    }

    fn instantiate(&self, reads: Reads) -> Result<(Store<Host>, Instance), HostError> {
        let host = Host {
            wasi: clock::build_context().build_p1(),
            reads,
            refusal: None,
        };
        let mut store = Store::new(&self.engine, host);
        let mut linker: Linker<Host> = Linker::new(&self.engine);

        p1::add_to_linker_sync(&mut linker, |host| &mut host.wasi)?;

        for read in &self.manifest.imports {
            let (target, length, into) = match read {
                Read::Row {
                    table,
                    length,
                    into,
                } => (ReadTarget::Row(table.clone()), length, into),
                Read::ScopeFacts { length, into } => (ReadTarget::ScopeFacts, length, into),
            };
            let into_target = target.clone();

            linker.func_wrap(
                "scriptc",
                length,
                move |caller: Caller<'_, Host>, pointer: i32, size: i32| {
                    read_length(caller, &target, pointer, size)
                },
            )?;
            linker.func_wrap(
                "scriptc",
                into,
                move |caller: Caller<'_, Host>,
                      argument_pointer: i32,
                      argument_length: i32,
                      buffer_pointer: i32,
                      buffer_length: i32| {
                    read_into(
                        caller,
                        &into_target,
                        (argument_pointer, argument_length),
                        (buffer_pointer, buffer_length),
                    )
                },
            )?;
        }

        linker.func_wrap("scriptc", "panic", panic)?;

        let instance = linker.instantiate(&mut store, &self.module)?;

        instance
            .get_typed_func::<(), ()>(&mut store, "_initialize")?
            .call(&mut store, ())?;
        instance
            .get_typed_func::<(), ()>(&mut store, &self.manifest.exports.init)?
            .call(&mut store, ())?;

        Ok((store, instance))
    }

    fn apply(&self, reads: Reads, input: &str) -> Result<String, HostError> {
        let (mut store, instance) = self.instantiate(reads)?;
        let output = call_string_export(&mut store, &instance, &self.manifest.exports.apply, input);

        // A trap that a refused read caused reports the refusal, not the trap.
        match (store.data_mut().refusal.take(), output) {
            (Some(refusal), Err(_)) => Err(refusal),
            (_, output) => output,
        }
    }
}

impl FactRunner for ModuleRunner {
    fn apply_fact(&mut self, fact: &str, rows: Arc<dyn RowSource>) -> Result<String, HostError> {
        self.apply(Reads::Rows(rows), fact)
    }
}

impl ScopeRunner for ModuleRunner {
    fn apply_scope(
        &mut self,
        scope: &str,
        facts: Arc<dyn FactSource>,
    ) -> Result<String, HostError> {
        self.apply(Reads::ScopeFacts(facts), scope)
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

// A row read answers `None` for no row; the scope read always answers.
fn read_value(
    caller: &mut Caller<'_, Host>,
    target: &ReadTarget,
    pointer: i32,
    length: i32,
) -> wasmtime::Result<Option<Vec<u8>>> {
    let argument = read_key(caller, pointer, length)?;
    let read = match (&caller.data().reads, target) {
        (Reads::Rows(rows), ReadTarget::Row(table)) => rows.read_row(table, &argument),
        (Reads::ScopeFacts(facts), ReadTarget::ScopeFacts) => {
            facts.read_scope_facts(&argument).map(Some)
        }
        (Reads::Rows(_), ReadTarget::ScopeFacts) | (Reads::ScopeFacts(_), ReadTarget::Row(_)) => {
            Err(HostError::BadManifest {
                path: "manifest.imports".to_owned(),
                reason: "a read of the other mode".to_owned(),
            })
        }
    };

    read.map_err(|error| {
        let message = error.to_string();

        caller.data_mut().refusal.get_or_insert(error);

        wasmtime::Error::msg(message)
    })
}

fn read_length(
    mut caller: Caller<'_, Host>,
    target: &ReadTarget,
    pointer: i32,
    length: i32,
) -> wasmtime::Result<f64> {
    Ok(
        read_value(&mut caller, target, pointer, length)?.map_or(-1.0, |value| {
            f64::from(u32::try_from(value.len()).unwrap_or(u32::MAX))
        }),
    )
}

fn read_into(
    mut caller: Caller<'_, Host>,
    target: &ReadTarget,
    (argument_pointer, argument_length): (i32, i32),
    (buffer_pointer, buffer_length): (i32, i32),
) -> wasmtime::Result<()> {
    let Some(value) = read_value(&mut caller, target, argument_pointer, argument_length)? else {
        return Ok(());
    };
    let capacity = usize::try_from(buffer_length)?;
    let memory = caller_memory(&mut caller)?;

    memory.write(
        &mut caller,
        usize::try_from(buffer_pointer)?,
        &value[..value.len().min(capacity)],
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
