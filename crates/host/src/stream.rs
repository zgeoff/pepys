use s2_sdk::types::{
    BasinName, ReadFrom, ReadInput, ReadLimits, ReadStart, ReadStop, S2Config, S2Endpoints,
    StreamName,
};
use s2_sdk::{S2, S2Stream};

use crate::batch::Fact;
use crate::error::HostError;

/// Where the log is and how to reach it.
#[derive(Debug, Clone)]
pub struct S2Settings {
    pub endpoint: String,
    pub access_token: String,
    pub basin: String,
}

/// A reader of one stream of the log.
pub struct StreamReader {
    stream: S2Stream,
}

fn to_stream_error(error: impl std::fmt::Display) -> HostError {
    HostError::Stream(error.to_string())
}

impl StreamReader {
    /// # Errors
    /// Fails when the endpoint, basin or stream name is not valid.
    pub fn connect(settings: &S2Settings, stream: &str) -> Result<Self, HostError> {
        let config = S2Config::new(settings.access_token.as_str()).with_endpoints(
            S2Endpoints::for_endpoint(&settings.endpoint).map_err(to_stream_error)?,
        );
        let client = S2::new(config).map_err(to_stream_error)?;
        let basin_name: BasinName = settings.basin.parse().map_err(to_stream_error)?;
        let stream_name: StreamName = stream.parse().map_err(to_stream_error)?;

        Ok(Self {
            stream: client.basin(basin_name).stream(stream_name),
        })
    }

    /// The sequence number the next record will get, which is also the number of records.
    ///
    /// # Errors
    /// Fails when the log cannot be reached.
    pub async fn tail(&self) -> Result<u64, HostError> {
        let position = self.stream.check_tail().await.map_err(to_stream_error)?;

        Ok(position.seq_num)
    }

    /// Up to `count` records from sequence number `from`. The caller has checked `from` is below
    /// the tail.
    ///
    /// # Errors
    /// Fails when the log cannot be read or a record is not UTF-8.
    pub async fn read(&self, from: u64, count: usize) -> Result<Vec<Fact>, HostError> {
        let input = ReadInput::new()
            .with_start(ReadStart::new().with_from(ReadFrom::SeqNum(from)))
            .with_stop(ReadStop::new().with_limits(ReadLimits::new().with_count(count)));
        let batch = self.stream.read(input).await.map_err(to_stream_error)?;

        batch
            .records
            .into_iter()
            .map(|record| {
                Ok(Fact {
                    seq_num: record.seq_num,
                    body: String::from_utf8(record.body.to_vec()).map_err(to_stream_error)?,
                })
            })
            .collect()
    }
}
