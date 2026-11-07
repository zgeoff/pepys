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
}

pub struct GarageBlobStore {
    bucket: Bucket,
    credentials: Credentials,
    client: Client<HttpConnector, Full<Bytes>>,
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
        })
    }

    async fn send(
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

        if status == StatusCode::NOT_FOUND {
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
