use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Args, Parser, Subcommand};
use pepys_host::commands::{self, HostConfig};
use pepys_host::error::HostError;
use pepys_host::stream::S2Settings;

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
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Tail the stream and apply batches until stopped.
    Run { consumer: String },
    /// Build a module's version beside the current one and swap it in.
    Up {
        consumer: String,
        #[arg(long)]
        module: PathBuf,
    },
    /// Print the row diff a module would make against the current version.
    Preview {
        consumer: String,
        #[arg(long)]
        module: PathBuf,
    },
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
    })
}

async fn execute(cli: Cli) -> Result<(), HostError> {
    let config = config(cli.connection)?;

    match cli.command {
        Command::Run { consumer } => commands::run(&config, &consumer).await,
        Command::Up { consumer, module } => {
            print!("{}", commands::up(&config, &consumer, &module).await?);

            Ok(())
        }
        Command::Preview { consumer, module } => {
            println!("{}", commands::preview(&config, &consumer, &module).await?);

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
