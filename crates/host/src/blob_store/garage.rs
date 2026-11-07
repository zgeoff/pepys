//! Blobs as objects in a Garage bucket, each keyed by its hash.

use std::time::Duration;

use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::{Method, Request, StatusCode};
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::TokioExecutor;
use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle};
use url::Url;

use super::{BlobStore, build_blob_hash, is_blob_hash};
use crate::error::HostError;

/// Where the bucket is and the key that reaches it.
#[derive(Debug, Clone)]
pub struct GarageSettings {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub request_timeout: Duration,
}

pub struct GarageBlobStore {
    bucket: Bucket,
    credentials: Credentials,
    client: Client<HttpConnector, Full<Bytes>>,
    request_timeout: Duration,
}

const SIGNATURE_LIFETIME: Duration = Duration::from_mins(1);

fn to_unavailable(error: impl std::fmt::Display) -> HostError {
    HostError::BlobUnavailable(error.to_string())
}

impl GarageBlobStore {
    /// # Errors
    /// Fails when the endpoint is not an HTTP URL.
    pub fn connect(settings: &GarageSettings) -> Result<Self, HostError> {
        let endpoint: Url = settings
            .endpoint
            .parse()
            .map_err(|error| HostError::Config(format!("the Garage endpoint: {error}")))?;
        let bucket = Bucket::new(
            endpoint,
            UrlStyle::Path,
            settings.bucket.clone(),
            settings.region.clone(),
        )
        .map_err(|error| HostError::Config(format!("the Garage bucket: {error}")))?;

        Ok(Self {
            bucket,
            credentials: Credentials::new(&settings.access_key_id, &settings.secret_access_key),
            client: Client::builder(TokioExecutor::new()).build_http(),
            request_timeout: settings.request_timeout,
        })
    }

    /// Sends one request, and fails as unavailable when the answer takes longer than the request
    /// timeout: the HTTP client has no timeout of its own.
    async fn send(
        &self,
        method: Method,
        url: &Url,
        body: Bytes,
    ) -> Result<(StatusCode, Bytes), HostError> {
        tokio::time::timeout(self.request_timeout, self.send_once(method, url, body))
            .await
            .map_err(|_| {
                to_unavailable(format!(
                    "Garage had no answer after {:?}",
                    self.request_timeout
                ))
            })?
    }

    async fn send_once(
        &self,
        method: Method,
        url: &Url,
        body: Bytes,
    ) -> Result<(StatusCode, Bytes), HostError> {
        let request = Request::builder()
            .method(method)
            .uri(url.as_str())
            .body(Full::new(body))
            .map_err(to_unavailable)?;
        let response = self.client.request(request).await.map_err(to_unavailable)?;
        let status = response.status();
        let bytes = response
            .into_body()
            .collect()
            .await
            .map_err(to_unavailable)?
            .to_bytes();

        Ok((status, bytes))
    }
}

impl BlobStore for GarageBlobStore {
    async fn write(&self, bytes: &[u8]) -> Result<String, HostError> {
        let hash = build_blob_hash(bytes);
        let url = self
            .bucket
            .put_object(Some(&self.credentials), &hash)
            .sign(SIGNATURE_LIFETIME);
        let (status, _) = self
            .send(Method::PUT, &url, Bytes::copy_from_slice(bytes))
            .await?;

        if !status.is_success() {
            return Err(to_unavailable(format!(
                "Garage answered {status} to a write"
            )));
        }

        Ok(hash)
    }

    async fn read(&self, hash: &str) -> Result<Vec<u8>, HostError> {
        if !is_blob_hash(hash) {
            return Err(HostError::MissingBlob(hash.to_owned()));
        }

        let url = self
            .bucket
            .get_object(Some(&self.credentials), hash)
            .sign(SIGNATURE_LIFETIME);
        let (status, bytes) = self.send(Method::GET, &url, Bytes::new()).await?;

        if is_missing_key(status, &bytes) {
            return Err(HostError::MissingBlob(hash.to_owned()));
        }

        if !status.is_success() {
            return Err(to_unavailable(format!(
                "Garage answered {status} to a read"
            )));
        }

        Ok(bytes.to_vec())
    }
}

/// Garage answers 404 for a missing bucket too, so only a `NoSuchKey` error marks a missing blob.
fn is_missing_key(status: StatusCode, body: &[u8]) -> bool {
    status == StatusCode::NOT_FOUND
        && body
            .windows(NO_SUCH_KEY.len())
            .any(|window| window == NO_SUCH_KEY)
}

const NO_SUCH_KEY: &[u8] = b"<Code>NoSuchKey</Code>";

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn it_marks_only_a_no_such_key_answer_as_a_missing_blob() {
        let answers = [
            (
                StatusCode::NOT_FOUND,
                &b"<Error><Code>NoSuchKey</Code></Error>"[..],
            ),
            (
                StatusCode::NOT_FOUND,
                &b"<Error><Code>NoSuchBucket</Code></Error>"[..],
            ),
            (
                StatusCode::FORBIDDEN,
                &b"<Error><Code>NoSuchKey</Code></Error>"[..],
            ),
        ];

        let missing: Vec<bool> = answers
            .iter()
            .map(|(status, body)| is_missing_key(*status, body))
            .collect();

        assert_eq!(missing, vec![true, false, false]);
    }

    #[tokio::test]
    async fn it_reports_a_read_from_a_store_that_never_answers_as_unavailable() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("a port");
        let address = listener.local_addr().expect("an address");
        let store = GarageBlobStore::connect(&GarageSettings {
            endpoint: format!("http://{address}"),
            region: "garage".to_owned(),
            bucket: "blobs".to_owned(),
            access_key_id: "GK0000000000000000000000ab".to_owned(),
            secret_access_key: "a-secret-for-a-store-that-never-answers".to_owned(),
            request_timeout: Duration::from_millis(50),
        })
        .expect("a store");

        let read = store.read(&"ab".repeat(32)).await;

        assert!(
            matches!(read, Err(HostError::BlobUnavailable(_))),
            "{read:?}"
        );
    }
}
