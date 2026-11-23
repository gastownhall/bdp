//! A deliberately tiny async HTTP/1.1 layer over `tokio` — just enough for the spike.
//!
//! Constraints (documented simplifications, NOT a general HTTP stack):
//!   * framing is `Content-Length` only (no chunked transfer-encoding);
//!   * one request/response per connection (`Connection: close`);
//!   * header names compared case-insensitively; values are UTF-8.
//!
//! The point of hand-rolling this is that the wire is fully visible: there is no framework
//! deciding status codes, content negotiation or routing for us — every such choice is the
//! protocol code's own, which is what surfaces trait↔wire friction honestly.

use std::collections::HashMap;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

// ---- messages ------------------------------------------------------------------

#[derive(Debug)]
pub struct HttpRequest {
    pub method: String,
    pub path: String, // percent-DECODED path, no query string
    pub query: HashMap<String, String>,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl HttpRequest {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

#[derive(Debug)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl HttpResponse {
    pub fn new(status: u16) -> Self {
        Self { status, headers: Vec::new(), body: Vec::new() }
    }
    pub fn json(status: u16, body: Vec<u8>) -> Self {
        let mut r = Self::new(status);
        r.headers.push(("content-type".into(), "application/json".into()));
        r.body = body;
        r
    }
    pub fn header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }
    pub fn header_value(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
    /// ALL values for a header name (for multi-valued headers like `BDP-Warning`, one line each).
    pub fn header_values(&self, name: &str) -> Vec<&str> {
        self.headers
            .iter()
            .filter(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
            .collect()
    }
}

// ---- base64url (no padding) — the ratified opaque-cursor encoding (RFC 4648 §5) ----

const B64URL: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

pub fn b64url_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() * 4 + 2) / 3);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64URL[((n >> 18) & 63) as usize] as char);
        out.push(B64URL[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(B64URL[((n >> 6) & 63) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(B64URL[(n & 63) as usize] as char);
        }
    }
    out
}

pub fn b64url_decode(s: &str) -> Vec<u8> {
    let mut rev = [255u8; 256];
    for (i, &c) in B64URL.iter().enumerate() {
        rev[c as usize] = i as u8;
    }
    let vals: Vec<u8> = s.bytes().filter_map(|c| {
        let v = rev[c as usize];
        if v == 255 { None } else { Some(v) }
    }).collect();
    let mut out = Vec::with_capacity(vals.len() * 3 / 4);
    let mut i = 0;
    while i < vals.len() {
        let n = vals.len() - i;
        if n >= 2 {
            out.push((vals[i] << 2) | (vals[i + 1] >> 4));
        }
        if n >= 3 {
            out.push((vals[i + 1] << 4) | (vals[i + 2] >> 2));
        }
        if n >= 4 {
            out.push((vals[i + 2] << 6) | vals[i + 3]);
        }
        i += 4;
    }
    out
}

pub type HttpError = std::io::Error;
fn ioerr(msg: impl Into<String>) -> HttpError {
    std::io::Error::new(std::io::ErrorKind::InvalidData, msg.into())
}

// ---- percent-encoding (minimal; unreserved set per RFC 3986) --------------------

pub fn pct_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

pub fn pct_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn parse_query(q: &str) -> HashMap<String, String> {
    let mut m = HashMap::new();
    for pair in q.split('&').filter(|p| !p.is_empty()) {
        let (k, v) = match pair.split_once('=') {
            Some((k, v)) => (k, v),
            None => (pair, ""),
        };
        m.insert(pct_decode(k), pct_decode(v));
    }
    m
}

// ---- low-level read: headers then Content-Length body ---------------------------

async fn read_head(stream: &mut TcpStream, buf: &mut Vec<u8>) -> Result<usize, HttpError> {
    // Read until we see the CRLFCRLF header terminator; return its end offset.
    let mut tmp = [0u8; 1024];
    loop {
        if let Some(pos) = find_subslice(buf, b"\r\n\r\n") {
            return Ok(pos + 4);
        }
        let n = stream.read(&mut tmp).await?;
        if n == 0 {
            return Err(ioerr("connection closed before headers complete"));
        }
        buf.extend_from_slice(&tmp[..n]);
    }
}

fn find_subslice(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

fn parse_headers(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter(|l| !l.is_empty())
        .filter_map(|l| l.split_once(':').map(|(k, v)| (k.trim().to_string(), v.trim().to_string())))
        .collect()
}

fn content_length(headers: &[(String, String)]) -> usize {
    headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.trim().parse().ok())
        .unwrap_or(0)
}

async fn read_body(stream: &mut TcpStream, buf: &mut Vec<u8>, head_end: usize, len: usize) -> Result<Vec<u8>, HttpError> {
    let mut body = buf[head_end..].to_vec();
    while body.len() < len {
        let mut tmp = [0u8; 4096];
        let n = stream.read(&mut tmp).await?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&tmp[..n]);
    }
    body.truncate(len);
    Ok(body)
}

// ---- server side ----------------------------------------------------------------

pub async fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, HttpError> {
    let mut buf = Vec::new();
    let head_end = read_head(stream, &mut buf).await?;
    let head_text = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let mut lines = head_text.split("\r\n");
    let request_line = lines.next().ok_or_else(|| ioerr("empty request"))?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().ok_or_else(|| ioerr("no method"))?.to_string();
    let target = parts.next().ok_or_else(|| ioerr("no target"))?.to_string();
    let (raw_path, query) = match target.split_once('?') {
        Some((p, q)) => (p.to_string(), parse_query(q)),
        None => (target, HashMap::new()),
    };
    let header_block: String = {
        let idx = head_text.find("\r\n").map(|i| i + 2).unwrap_or(0);
        head_text[idx..].to_string()
    };
    let headers = parse_headers(&header_block);
    let len = content_length(&headers);
    let body = read_body(stream, &mut buf, head_end, len).await?;
    Ok(HttpRequest { method, path: pct_decode(&raw_path), query, headers, body })
}

pub async fn write_response(stream: &mut TcpStream, resp: &HttpResponse) -> Result<(), HttpError> {
    let reason = reason_phrase(resp.status);
    let mut out = format!("HTTP/1.1 {} {}\r\n", resp.status, reason);
    let mut saw_len = false;
    for (k, v) in &resp.headers {
        if k.eq_ignore_ascii_case("content-length") {
            saw_len = true;
        }
        out.push_str(&format!("{}: {}\r\n", k, v));
    }
    if !saw_len {
        out.push_str(&format!("content-length: {}\r\n", resp.body.len()));
    }
    out.push_str("connection: close\r\n\r\n");
    stream.write_all(out.as_bytes()).await?;
    stream.write_all(&resp.body).await?;
    stream.flush().await?;
    Ok(())
}

// ---- client side ----------------------------------------------------------------

pub struct Outgoing<'a> {
    pub method: &'a str,
    pub host: &'a str, // "127.0.0.1:PORT"
    pub target: &'a str, // path + optional ?query, already percent-encoded
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

pub async fn send(req: Outgoing<'_>) -> Result<HttpResponse, HttpError> {
    let mut stream = TcpStream::connect(req.host).await?;
    let mut out = format!("{} {} HTTP/1.1\r\n", req.method, req.target);
    out.push_str(&format!("host: {}\r\n", req.host));
    for (k, v) in &req.headers {
        out.push_str(&format!("{}: {}\r\n", k, v));
    }
    out.push_str(&format!("content-length: {}\r\n", req.body.len()));
    out.push_str("connection: close\r\n\r\n");
    stream.write_all(out.as_bytes()).await?;
    if !req.body.is_empty() {
        stream.write_all(&req.body).await?;
    }
    stream.flush().await?;

    let mut buf = Vec::new();
    let head_end = read_head(&mut stream, &mut buf).await?;
    let head_text = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let mut lines = head_text.split("\r\n");
    let status_line = lines.next().ok_or_else(|| ioerr("empty response"))?;
    let status: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| ioerr("bad status line"))?;
    let header_block: String = {
        let idx = head_text.find("\r\n").map(|i| i + 2).unwrap_or(0);
        head_text[idx..].to_string()
    };
    let headers = parse_headers(&header_block);
    let len = content_length(&headers);
    // If no content-length on the response, read to EOF.
    let body = if headers.iter().any(|(k, _)| k.eq_ignore_ascii_case("content-length")) {
        read_body(&mut stream, &mut buf, head_end, len).await?
    } else {
        let mut body = buf[head_end..].to_vec();
        let mut tmp = [0u8; 4096];
        loop {
            let n = stream.read(&mut tmp).await?;
            if n == 0 {
                break;
            }
            body.extend_from_slice(&tmp[..n]);
        }
        body
    };
    Ok(HttpResponse { status, headers, body })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_roundtrips() {
        for sample in [&b""[..], b"A", b"AB", b"ABC", b"ABCD", b"\x00\xff\x10opaque-cursor\x7f"] {
            assert_eq!(b64url_decode(&b64url_encode(sample)), sample, "roundtrip {sample:?}");
        }
        // URL-safe alphabet: no '+', '/', or '=' padding.
        let enc = b64url_encode(b"\xfb\xff\xfe");
        assert!(!enc.contains('+') && !enc.contains('/') && !enc.contains('='), "got {enc}");
    }
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        202 => "Accepted",
        400 => "Bad Request",
        404 => "Not Found",
        406 => "Not Acceptable",
        409 => "Conflict",
        410 => "Gone",
        412 => "Precondition Failed",
        422 => "Unprocessable Entity",
        500 => "Internal Server Error",
        501 => "Not Implemented",
        _ => "Status",
    }
}
