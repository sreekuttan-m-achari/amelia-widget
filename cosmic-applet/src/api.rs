use std::time::Duration;

use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio_tungstenite::{connect_async, tungstenite::Message as WsMessage};

#[derive(Debug, Clone, Deserialize)]
pub struct Health {
    pub ok: bool,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub warm: bool,
    #[serde(default)]
    pub greeting: Option<String>,
    #[serde(default)]
    pub persona: bool,
    #[serde(default)]
    pub user_profile: bool,
}

#[derive(Debug, Clone, Serialize)]
struct ChatRequest<'a> {
    message: &'a str,
    id: &'a str,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChatResponse {
    #[serde(default)]
    pub reply: String,
    #[serde(default)]
    pub cancelled: bool,
}

#[derive(Debug, Clone)]
pub enum WsInbound {
    Ready {
        greeting: Option<String>,
        warm: bool,
    },
    Greeting(String),
    Chunk {
        id: String,
        text: String,
    },
    Done {
        id: String,
        reply: String,
    },
    Cancelled {
        id: String,
        reply: Option<String>,
    },
    Error {
        id: Option<String>,
        error: String,
    },
    Disconnected,
}

pub fn api_base() -> String {
    std::env::var("AMELIA_API_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "http://127.0.0.1:8787".to_string())
        .trim_end_matches('/')
        .to_string()
}

pub fn ws_url() -> String {
    let base = api_base();
    if let Some(rest) = base.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = base.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        "ws://127.0.0.1:8787".to_string()
    }
}

fn systemd_service_name() -> String {
    std::env::var("AMELIA_SYSTEMD_SERVICE")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "amelia-widget.service".to_string())
}

pub async fn start_server_via_systemd() -> Result<(), String> {
    let service = systemd_service_name();
    let output = tokio::process::Command::new("systemctl")
        .args(["--user", "start", &service])
        .output()
        .await
        .map_err(|err| format!("failed to run systemctl: {err}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        Err(if detail.is_empty() {
            format!("systemctl --user start {service} failed")
        } else {
            detail
        })
    }
}

/// Ensure the Amelia API is up. Starts the systemd user service once if needed.
pub async fn ensure_server_ready(start_already_attempted: bool) -> (Result<Health, String>, bool) {
    if let Ok(health) = fetch_health().await {
        if health.ok {
            return (Ok(health), start_already_attempted);
        }
    }

    let mut start_attempted = start_already_attempted;
    if !start_attempted {
        let _ = start_server_via_systemd().await;
        start_attempted = true;
    }

    for delay_ms in [400_u64, 800, 1200, 1800, 2500, 3500] {
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
        if let Ok(health) = fetch_health().await {
            if health.ok {
                return (Ok(health), start_attempted);
            }
        }
    }

    (fetch_health().await, start_attempted)
}

pub async fn fetch_health() -> Result<Health, String> {
    let url = format!("{}/health", api_base());
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|err| err.to_string())?
        .get(url)
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    response
        .json::<Health>()
        .await
        .map_err(|err| err.to_string())
}

pub async fn post_chat(message: String, id: String) -> Result<ChatResponse, String> {
    let url = format!("{}/chat", api_base());
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|err| err.to_string())?
        .post(url)
        .json(&ChatRequest {
            message: &message,
            id: &id,
        })
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    response
        .json::<ChatResponse>()
        .await
        .map_err(|err| err.to_string())
}

pub async fn post_cancel(id: String) -> Result<(), String> {
    let url = format!("{}/chat/cancel", api_base());
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|err| err.to_string())?
        .post(url)
        .json(&serde_json::json!({ "id": id }))
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("HTTP {}", response.status()))
    }
}

pub async fn ws_send_chat(
    ws_tx: &tokio::sync::mpsc::UnboundedSender<String>,
    id: &str,
    message: &str,
) -> Result<(), String> {
    let payload = serde_json::json!({
        "type": "chat",
        "id": id,
        "message": message,
    });
    ws_tx
        .send(payload.to_string())
        .map_err(|err| err.to_string())
}

pub async fn ws_send_cancel(ws_tx: &tokio::sync::mpsc::UnboundedSender<String>, id: &str) -> Result<(), String> {
    let payload = serde_json::json!({
        "type": "cancel",
        "id": id,
    });
    ws_tx
        .send(payload.to_string())
        .map_err(|err| err.to_string())
}

fn parse_ws_message(raw: &str) -> Option<WsInbound> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let kind = value.get("type")?.as_str()?;

    match kind {
        "ready" => Some(WsInbound::Ready {
            greeting: value
                .get("greeting")
                .and_then(|g| g.as_str())
                .map(str::to_string),
            warm: value.get("warm").and_then(|w| w.as_bool()).unwrap_or(false),
        }),
        "greeting" => Some(WsInbound::Greeting(
            value
                .get("text")
                .and_then(|t| t.as_str())
                .unwrap_or_default()
                .to_string(),
        )),
        "chunk" => Some(WsInbound::Chunk {
            id: value.get("id")?.as_str()?.to_string(),
            text: value
                .get("text")
                .and_then(|t| t.as_str())
                .unwrap_or_default()
                .to_string(),
        }),
        "done" => Some(WsInbound::Done {
            id: value.get("id")?.as_str()?.to_string(),
            reply: value
                .get("reply")
                .and_then(|r| r.as_str())
                .unwrap_or_default()
                .to_string(),
        }),
        "cancelled" => Some(WsInbound::Cancelled {
            id: value.get("id")?.as_str()?.to_string(),
            reply: value
                .get("reply")
                .and_then(|r| r.as_str())
                .map(str::to_string),
        }),
        "error" => Some(WsInbound::Error {
            id: value
                .get("id")
                .and_then(|id| id.as_str())
                .map(str::to_string),
            error: value
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("Unknown error")
                .to_string(),
        }),
        _ => None,
    }
}

pub async fn run_ws_loop(
    outbound: tokio::sync::mpsc::UnboundedSender<WsInbound>,
    mut inbound: tokio::sync::mpsc::UnboundedReceiver<String>,
) {
    loop {
        let connect = connect_async(&ws_url()).await;
        let Ok((mut socket, _)) = connect else {
            let _ = outbound.send(WsInbound::Disconnected);
            tokio::time::sleep(Duration::from_secs(3)).await;
            continue;
        };

        loop {
            tokio::select! {
                maybe_out = inbound.recv() => {
                    match maybe_out {
                        Some(payload) => {
                            if socket.send(WsMessage::Text(payload.into())).await.is_err() {
                                break;
                            }
                        }
                        None => return,
                    }
                }
                maybe_in = socket.next() => {
                    match maybe_in {
                        Some(Ok(WsMessage::Text(text))) => {
                            if let Some(event) = parse_ws_message(&text) {
                                let _ = outbound.send(event);
                            }
                        }
                        Some(Ok(WsMessage::Close(_))) | Some(Err(_)) | None => break,
                        _ => {}
                    }
                }
            }
        }

        let _ = outbound.send(WsInbound::Disconnected);
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}
