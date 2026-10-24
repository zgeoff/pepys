//! Runs the review-links consumer through one boundary shape. Reads a JSON array of consumer inputs
//! on stdin and writes a JSON array of results on stdout.

mod clock;
mod component;
mod core_module;
mod rows;

use std::io::{Read, Write};
use std::process::ExitCode;
use std::time::Instant;

use serde_json::{Value, json};
use thiserror::Error;
use wasmtime::{Config, Engine};

#[derive(Debug, Error)]
pub enum BoundaryError {
    #[error("usage: pepys-host-boundary <core|component> <prefetch|reads> <module>")]
    Usage,
    #[error("stdin is not a JSON array of input strings")]
    Input,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Wasm(#[from] wasmtime::Error),
    #[error("the module does not export {0}")]
    MissingExport(&'static str),
    #[error("the consumer panicked: {0}")]
    Panicked(String),
    #[error("the module wrote a result outside its memory")]
    OutOfBounds,
}

#[derive(Clone, Copy)]
pub enum ReadShape {
    Prefetch,
    Reads,
}

pub struct RunTiming {
    pub instantiate_micros: u128,
    pub call_micros: u128,
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), BoundaryError> {
    let args: Vec<String> = std::env::args().collect();
    let [_, kind, reads, path] = args.as_slice() else {
        return Err(BoundaryError::Usage);
    };
    let reads = match reads.as_str() {
        "prefetch" => ReadShape::Prefetch,
        "reads" => ReadShape::Reads,
        _ => return Err(BoundaryError::Usage),
    };

    let mut stdin = String::new();
    std::io::stdin().read_to_string(&mut stdin)?;
    let inputs: Vec<String> = serde_json::from_str(&stdin).map_err(|_| BoundaryError::Input)?;

    let mut config = Config::new();
    config.wasm_component_model(true);
    let engine = Engine::new(&config)?;
    let compile_start = Instant::now();

    let results: Vec<Value> = match kind.as_str() {
        "core" => {
            let module = wasmtime::Module::from_file(&engine, path)?;
            let compile_micros = compile_start.elapsed().as_micros();
            inputs
                .iter()
                .map(|input| {
                    let split = rows::split(input, reads);
                    let outcome = core_module::run(&engine, &module, &split, reads);
                    to_result(outcome, compile_micros)
                })
                .collect()
        }
        "component" => {
            let component = wasmtime::component::Component::from_file(&engine, path)?;
            let compile_micros = compile_start.elapsed().as_micros();
            inputs
                .iter()
                .map(|input| {
                    let split = rows::split(input, reads);
                    let outcome = component::run(&engine, &component, &split, reads);
                    to_result(outcome, compile_micros)
                })
                .collect()
        }
        _ => return Err(BoundaryError::Usage),
    };

    let mut stdout = std::io::stdout().lock();
    serde_json::to_writer(&mut stdout, &results)?;
    writeln!(stdout)?;
    Ok(())
}

fn to_result(outcome: Result<(String, RunTiming), BoundaryError>, compile_micros: u128) -> Value {
    let clock_reads = clock::READS.swap(0, std::sync::atomic::Ordering::Relaxed);
    match outcome {
        Ok((output, timing)) => json!({
            "output": output,
            "compileMicros": compile_micros,
            "instantiateMicros": timing.instantiate_micros,
            "callMicros": timing.call_micros,
            "clockReads": clock_reads,
        }),
        Err(error) => json!({ "error": format!("{error:#}") }),
    }
}
