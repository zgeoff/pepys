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
pub mod error;
pub mod fact_index;
pub mod fact_log;
pub mod links;
pub mod lock;
pub mod manifest;
pub mod module_runner;
pub mod pull_request_rows;
pub mod rows;
pub mod scope;
#[cfg(test)]
mod spike;
#[cfg(test)]
mod test_utils;
pub mod versions;
