//! The pepys host, which runs consumers and applies the operations they return.

pub mod batch;
pub mod blob_store;
pub mod clock;
pub mod commands;
pub mod consumer;
pub mod database;
pub mod diff;
#[cfg(test)]
mod e2e;
pub mod entity_ids;
pub mod error;
pub mod fact_index;
pub mod fact_log;
pub mod links;
pub mod lock;
pub mod module_runner;
pub mod operations;
pub mod rows;
pub mod schema_check;
pub mod scope;
pub mod scope_replace;
#[cfg(test)]
mod test_utils;
pub mod versions;
