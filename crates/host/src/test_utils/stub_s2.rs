//! An S2 append endpoint on turmoil's simulated network, and the connector that reaches it.

use std::future::Future;
use std::io;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};

use http_body_util::{BodyExt, Full};
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http2;
use hyper::service::service_fn;
use hyper::{Response, StatusCode, Uri};
use hyper_util::client::legacy::connect::{Connected, Connection};
use hyper_util::rt::{TokioExecutor, TokioIo};
use prost::Message;
use s2_api::v1::stream::proto::{AppendAck, AppendInput, StreamPosition};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

/// The host names of the stub and of its client on the simulated network.
pub const STUB_S2_HOST: &str = "s2";
pub const WRITER_HOST: &str = "writer";

/// What the stub holds: the number of records on its one stream, and whether it holds back the
/// reply to the next append.
#[derive(Default)]
pub struct StubS2State {
    pub records: u64,
    pub is_next_reply_held: bool,
}

/// Answers appends on port 80 of the simulated host it runs on. An append whose `matchSeqNum` is
/// not the tail gets S2's 412 answer. A held reply waits until the test calls `turmoil::release`.
///
/// # Errors
/// Fails when the port cannot be bound.
pub async fn serve_stub_s2(state: Arc<Mutex<StubS2State>>) -> turmoil::Result {
    let listener = turmoil::net::TcpListener::bind(("0.0.0.0", 80)).await?;

    loop {
        let (stream, _) = listener.accept().await?;
        let state = Arc::clone(&state);
        let service = service_fn(move |request: hyper::Request<Incoming>| {
            let state = Arc::clone(&state);

            async move {
                let body = request.into_body().collect().await?.to_bytes();

                Ok::<_, hyper::Error>(answer_append(&state, &body))
            }
        });

        tokio::spawn(
            http2::Builder::new(TokioExecutor::new())
                .serve_connection(TokioIo::new(stream), service),
        );
    }
}

fn answer_append(state: &Mutex<StubS2State>, body: &[u8]) -> Response<Full<Bytes>> {
    let mut state = state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let Ok(input) = AppendInput::decode(body) else {
        return reply(StatusCode::BAD_REQUEST, Bytes::new());
    };

    if input.match_seq_num != Some(state.records) {
        let mismatch = format!(r#"{{"seq_num_mismatch":{}}}"#, state.records);

        return reply(StatusCode::PRECONDITION_FAILED, Bytes::from(mismatch));
    }

    let start = state.records;

    state.records += input.records.len() as u64;

    if state.is_next_reply_held {
        state.is_next_reply_held = false;
        turmoil::hold(STUB_S2_HOST, WRITER_HOST);
    }

    let position = |seq_num| {
        Some(StreamPosition {
            seq_num,
            timestamp: 0,
        })
    };
    let ack = AppendAck {
        start: position(start),
        end: position(state.records),
        tail: position(state.records),
    };

    reply(StatusCode::OK, Bytes::from(ack.encode_to_vec()))
}

fn reply(status: StatusCode, body: Bytes) -> Response<Full<Bytes>> {
    let mut response = Response::new(Full::new(body));

    *response.status_mut() = status;

    response
}

/// Opens a connection over the simulated network, for the S2 client.
#[derive(Clone)]
pub struct TurmoilConnector;

impl tower_service::Service<Uri> for TurmoilConnector {
    type Response = TokioIo<TurmoilStream>;
    type Error = io::Error;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, _context: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, uri: Uri) -> Self::Future {
        Box::pin(async move {
            let host = uri.host().unwrap_or(STUB_S2_HOST).to_owned();
            let stream =
                turmoil::net::TcpStream::connect((host, uri.port_u16().unwrap_or(80))).await?;

            Ok(TokioIo::new(TurmoilStream(stream)))
        })
    }
}

/// A simulated TCP stream that hyper's client can pool.
pub struct TurmoilStream(turmoil::net::TcpStream);

impl Connection for TurmoilStream {
    fn connected(&self) -> Connected {
        Connected::new()
    }
}

impl AsyncRead for TurmoilStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.0).poll_read(context, buffer)
    }
}

impl AsyncWrite for TurmoilStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.0).poll_write(context, buffer)
    }

    fn poll_flush(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.0).poll_flush(context)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.0).poll_shutdown(context)
    }
}
