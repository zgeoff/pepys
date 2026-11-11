use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Args, Parser, Subcommand};
use pepys_host::commands::{self, HostConfig};
use pepys_host::error::HostError;
use pepys_host::fact_log::s2::S2Settings;

#[derive(Debug, Parser)]
#[command(name = "pepys", about = "Runs pepys consumers")]
struct Cli {
    #[command(flatten)]
    connection: Connection,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Args)]
struct Connection {
    /// The S2 endpoint.
    #[arg(long, env = "PEPYS_S2_ENDPOINT", global = true)]
    s2_endpoint: Option<String>,
    /// The S2 access token.
    #[arg(
        long,
        env = "PEPYS_S2_ACCESS_TOKEN",
        global = true,
        hide_env_values = true
    )]
    s2_access_token: Option<String>,
    /// The S2 basin that holds the streams.
    #[arg(long, env = "PEPYS_S2_BASIN", global = true)]
    s2_basin: Option<String>,
    /// The directory that holds the consumers' files.
    #[arg(long, env = "PEPYS_STORE_DIR", global = true)]
    store_dir: Option<PathBuf>,
    /// The consumers.json that `pepys build` wrote.
    #[arg(long, env = "PEPYS_CONSUMERS", global = true)]
    consumers: Option<PathBuf>,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Run every listed consumer's current version, tailing its streams until stopped.
    Run {
        /// Deploy every listed consumer first.
        #[arg(long)]
        up: bool,
    },
    /// Build a listed version beside the current one and swap it in; with no name, every listed
    /// consumer in file order.
    Up {
        consumer: Option<String>,
        /// A kept previous version to swap back in, in place of the listed one.
        #[arg(long, requires = "consumer")]
        version: Option<String>,
    },
    /// Print the row diff the listed version would make against the current version.
    Preview { consumer: String },
}

fn required<T>(value: Option<T>, flag: &str) -> Result<T, HostError> {
    value.ok_or_else(|| HostError::Config(format!("{flag} is required")))
}

fn config(connection: Connection) -> Result<HostConfig, HostError> {
    Ok(HostConfig {
        s2: S2Settings {
            endpoint: required(connection.s2_endpoint, "--s2-endpoint")?,
            access_token: required(connection.s2_access_token, "--s2-access-token")?,
            basin: required(connection.s2_basin, "--s2-basin")?,
        },
        store_dir: required(connection.store_dir, "--store-dir")?,
        consumers: required(connection.consumers, "--consumers")?,
    })
}

async fn execute(cli: Cli) -> Result<(), HostError> {
    let config = config(cli.connection)?;

    match cli.command {
        Command::Run { up } => commands::run(&config, up).await,
        Command::Up { consumer, version } => {
            print!(
                "{}",
                commands::up(&config, consumer.as_deref(), version.as_deref()).await?
            );

            Ok(())
        }
        Command::Preview { consumer } => {
            println!("{}", commands::preview(&config, &consumer).await?);

            Ok(())
        }
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    match execute(Cli::parse()).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("pepys: {error}");

            ExitCode::FAILURE
        }
    }
}
