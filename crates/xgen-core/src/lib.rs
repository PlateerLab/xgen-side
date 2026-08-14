use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;
use std::time::Instant;

pub const PROTOCOL: &str = "xgen.core.v1";
pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_MESSAGE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_BLOB_CHARACTERS: usize = 12 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreRequest {
    pub protocol: String,
    pub id: String,
    pub method: String,
    #[serde(default)]
    pub session_token: Option<String>,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreResponse {
    pub protocol: &'static str,
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<CoreError>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreError {
    pub code: &'static str,
    pub message: &'static str,
}

#[derive(Debug)]
pub struct DispatchResult {
    pub response: CoreResponse,
    pub shutdown: bool,
    pub action: Option<CoreAction>,
}

#[derive(Debug)]
pub enum CoreAction {
    StartBrowser(BrowserStartSpec),
    StopBrowser { run_id: String },
    ReadStorage { key: StorageKey },
    WriteStorage { key: StorageKey, content: String },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StorageKey {
    Credentials,
    Settings,
    Workspace,
}

impl StorageKey {
    pub fn file_name(self) -> &'static str {
        match self {
            Self::Credentials => "credentials.vault",
            Self::Settings => "settings.json",
            Self::Workspace => "workspace.json",
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStartSpec {
    pub run_id: String,
    pub engine_path: String,
    pub tool_profiles: Vec<String>,
    pub environment: BTreeMap<String, String>,
}

pub struct XgenCore {
    session_token: Option<String>,
    started_at: Instant,
}

impl Default for XgenCore {
    fn default() -> Self {
        Self {
            session_token: None,
            started_at: Instant::now(),
        }
    }
}

impl XgenCore {
    pub fn dispatch(&mut self, request: CoreRequest) -> DispatchResult {
        if request.protocol != PROTOCOL {
            return rejected(
                request.id,
                "protocol_mismatch",
                "Unsupported XGEN Core protocol.",
            );
        }
        if !valid_request_id(&request.id) {
            return rejected(
                "invalid".to_string(),
                "invalid_request",
                "Invalid request identifier.",
            );
        }

        if request.method == "handshake" {
            return self.handshake(request);
        }

        let Some(expected_token) = self.session_token.as_deref() else {
            return rejected(
                request.id,
                "handshake_required",
                "A private handshake is required.",
            );
        };
        let Some(provided_token) = request.session_token.as_deref() else {
            return rejected(request.id, "unauthorized", "Invalid XGEN Core session.");
        };
        if !constant_time_equal(expected_token.as_bytes(), provided_token.as_bytes()) {
            return rejected(request.id, "unauthorized", "Invalid XGEN Core session.");
        }

        match request.method.as_str() {
            "health" => DispatchResult {
                response: success(
                    request.id,
                    json!({
                        "service": "xgen-core",
                        "protocolVersion": PROTOCOL_VERSION,
                        "platform": std::env::consts::OS,
                        "architecture": std::env::consts::ARCH,
                        "uptimeMs": self.started_at.elapsed().as_millis(),
                        "capabilities": ["health", "lifecycle", "browser-relay", "local-storage"],
                    }),
                ),
                shutdown: false,
                action: None,
            },
            "shutdown" => DispatchResult {
                response: success(request.id, json!({ "state": "stopping" })),
                shutdown: true,
                action: None,
            },
            "browser.start" => browser_start(request.id, request.params),
            "browser.stop" => browser_stop(request.id, request.params),
            "storage.read" => storage_read(request.id, request.params),
            "storage.write" => storage_write(request.id, request.params),
            _ => rejected(request.id, "method_not_found", "Unknown XGEN Core method."),
        }
    }

    fn handshake(&mut self, request: CoreRequest) -> DispatchResult {
        if self.session_token.is_some() {
            return rejected(
                request.id,
                "already_initialized",
                "The XGEN Core session is already initialized.",
            );
        }
        let token = request
            .params
            .get("sessionToken")
            .and_then(Value::as_str)
            .filter(|value| valid_session_token(value));
        let Some(token) = token else {
            return rejected(
                request.id,
                "invalid_handshake",
                "The private session token is invalid.",
            );
        };
        self.session_token = Some(token.to_string());
        DispatchResult {
            response: success(
                request.id,
                json!({
                    "service": "xgen-core",
                    "protocolVersion": PROTOCOL_VERSION,
                    "state": "ready",
                }),
            ),
            shutdown: false,
            action: None,
        }
    }
}

pub fn error_response(
    id: impl Into<String>,
    code: &'static str,
    message: &'static str,
) -> CoreResponse {
    CoreResponse {
        protocol: PROTOCOL,
        id: id.into(),
        ok: false,
        result: None,
        error: Some(CoreError { code, message }),
    }
}

fn success(id: String, result: Value) -> CoreResponse {
    CoreResponse {
        protocol: PROTOCOL,
        id,
        ok: true,
        result: Some(result),
        error: None,
    }
}

fn rejected(id: String, code: &'static str, message: &'static str) -> DispatchResult {
    DispatchResult {
        response: error_response(id, code, message),
        shutdown: false,
        action: None,
    }
}

fn browser_start(id: String, params: Value) -> DispatchResult {
    let Ok(spec) = serde_json::from_value::<BrowserStartSpec>(params) else {
        return rejected(
            id,
            "invalid_browser_start",
            "Invalid browser start request.",
        );
    };
    if !valid_run_id(&spec.run_id)
        || spec.engine_path.len() > 4_096
        || !Path::new(&spec.engine_path).is_absolute()
        || spec.tool_profiles.is_empty()
        || spec.tool_profiles.len() > 32
        || spec
            .tool_profiles
            .iter()
            .any(|profile| !valid_tool_profile(profile))
        || spec.environment.len() > 64
        || spec
            .environment
            .iter()
            .any(|(name, value)| !valid_environment_entry(name, value))
    {
        return rejected(
            id,
            "invalid_browser_start",
            "Invalid browser start request.",
        );
    }
    DispatchResult {
        response: success(id, json!({ "state": "starting" })),
        shutdown: false,
        action: Some(CoreAction::StartBrowser(spec)),
    }
}

fn browser_stop(id: String, params: Value) -> DispatchResult {
    let Some(run_id) = params.get("runId").and_then(Value::as_str) else {
        return rejected(id, "invalid_browser_stop", "Invalid browser stop request.");
    };
    if !valid_run_id(run_id) {
        return rejected(id, "invalid_browser_stop", "Invalid browser stop request.");
    }
    DispatchResult {
        response: success(id, json!({ "state": "stopping" })),
        shutdown: false,
        action: Some(CoreAction::StopBrowser {
            run_id: run_id.to_string(),
        }),
    }
}

fn storage_read(id: String, params: Value) -> DispatchResult {
    let Some(key) = storage_key(&params) else {
        return rejected(id, "invalid_storage_read", "Invalid storage read request.");
    };
    DispatchResult {
        response: success(id, json!({ "state": "reading" })),
        shutdown: false,
        action: Some(CoreAction::ReadStorage { key }),
    }
}

fn storage_write(id: String, params: Value) -> DispatchResult {
    let Some(key) = storage_key(&params) else {
        return rejected(id, "invalid_storage_write", "Invalid storage write request.");
    };
    let Some(content) = params.get("content").and_then(Value::as_str) else {
        return rejected(id, "invalid_storage_write", "Invalid storage write request.");
    };
    if content.len() > MAX_BLOB_CHARACTERS || content.bytes().any(|byte| byte == 0) {
        return rejected(id, "invalid_storage_write", "Invalid storage write request.");
    }
    DispatchResult {
        response: success(id, json!({ "state": "writing" })),
        shutdown: false,
        action: Some(CoreAction::WriteStorage {
            key,
            content: content.to_string(),
        }),
    }
}

fn storage_key(params: &Value) -> Option<StorageKey> {
    match params.get("key").and_then(Value::as_str)? {
        "credentials" => Some(StorageKey::Credentials),
        "settings" => Some(StorageKey::Settings),
        "workspace" => Some(StorageKey::Workspace),
        _ => None,
    }
}

fn valid_request_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

fn valid_session_token(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn valid_run_id(value: &str) -> bool {
    valid_request_id(value)
}

fn valid_tool_profile(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn valid_environment_entry(name: &str, value: &str) -> bool {
    if name.is_empty()
        || name.len() > 100
        || value.len() > 32_768
        || value.bytes().any(|byte| byte == 0)
    {
        return false;
    }
    const SYSTEM_NAMES: &[&str] = &[
        "APPDATA",
        "COMSPEC",
        "HOME",
        "LANG",
        "LC_ALL",
        "LOCALAPPDATA",
        "NO_COLOR",
        "PATH",
        "PATHEXT",
        "SHELL",
        "SSL_CERT_FILE",
        "SystemRoot",
        "TEMP",
        "TMP",
        "TMPDIR",
        "USER",
        "USERPROFILE",
        "WINDIR",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
    ];
    SYSTEM_NAMES.contains(&name)
        || name.starts_with("AGENT_BROWSER_")
        || name.starts_with("XGEN_")
        || name == "ELECTRON_RUN_AS_NODE"
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn request(id: &str, method: &str, session_token: Option<&str>, params: Value) -> CoreRequest {
        CoreRequest {
            protocol: PROTOCOL.to_string(),
            id: id.to_string(),
            method: method.to_string(),
            session_token: session_token.map(str::to_string),
            params,
        }
    }

    #[test]
    fn requires_private_handshake_before_health() {
        let mut core = XgenCore::default();
        let result = core.dispatch(request("one", "health", None, json!({})));
        assert!(!result.response.ok);
        assert_eq!(result.response.error.unwrap().code, "handshake_required");
    }

    #[test]
    fn accepts_one_handshake_and_state_only_health() {
        let mut core = XgenCore::default();
        let handshake = core.dispatch(request(
            "one",
            "handshake",
            None,
            json!({ "sessionToken": TOKEN }),
        ));
        assert!(handshake.response.ok);

        let health = core.dispatch(request("two", "health", Some(TOKEN), json!({})));
        assert!(health.response.ok);
        let serialized = serde_json::to_string(&health.response).unwrap();
        assert!(!serialized.contains(TOKEN));
        assert!(serialized.contains("xgen-core"));
        assert!(serialized.contains("lifecycle"));
    }

    #[test]
    fn rejects_wrong_token_and_repeated_handshake() {
        let mut core = XgenCore::default();
        assert!(
            core.dispatch(request(
                "one",
                "handshake",
                None,
                json!({ "sessionToken": TOKEN }),
            ))
            .response
            .ok
        );
        let wrong = "f".repeat(64);
        let denied = core.dispatch(request("two", "health", Some(&wrong), json!({})));
        assert_eq!(denied.response.error.unwrap().code, "unauthorized");
        let repeated = core.dispatch(request(
            "three",
            "handshake",
            None,
            json!({ "sessionToken": TOKEN }),
        ));
        assert_eq!(repeated.response.error.unwrap().code, "already_initialized");
    }

    #[test]
    fn authenticated_shutdown_stops_the_dispatch_loop() {
        let mut core = XgenCore::default();
        core.dispatch(request(
            "one",
            "handshake",
            None,
            json!({ "sessionToken": TOKEN }),
        ));
        let shutdown = core.dispatch(request("two", "shutdown", Some(TOKEN), json!({})));
        assert!(shutdown.response.ok);
        assert!(shutdown.shutdown);
    }

    #[test]
    fn authorizes_a_bounded_browser_relay_without_echoing_private_environment() {
        let mut core = XgenCore::default();
        core.dispatch(request(
            "one",
            "handshake",
            None,
            json!({ "sessionToken": TOKEN }),
        ));
        let engine_path = if cfg!(windows) {
            r"C:\XGEN Side\agent-browser.exe"
        } else {
            "/Applications/XGEN Side.app/agent-browser"
        };
        let start = core.dispatch(request(
            "two",
            "browser.start",
            Some(TOKEN),
            json!({
                "runId": "run-1",
                "enginePath": engine_path,
                "toolProfiles": ["core", "tabs"],
                "environment": {
                    "AGENT_BROWSER_CDP": "http://127.0.0.1:12345",
                    "XGEN_CREDENTIAL_TOKEN": "private-value"
                }
            }),
        ));
        assert!(start.response.ok);
        assert!(matches!(start.action, Some(CoreAction::StartBrowser(_))));
        let serialized = serde_json::to_string(&start.response).unwrap();
        assert!(!serialized.contains("12345"));
        assert!(!serialized.contains("private-value"));
    }

    #[test]
    fn rejects_unbounded_browser_environment() {
        let mut core = XgenCore::default();
        core.dispatch(request(
            "one",
            "handshake",
            None,
            json!({ "sessionToken": TOKEN }),
        ));
        let engine_path = if cfg!(windows) {
            r"C:\XGEN Side\agent-browser.exe"
        } else {
            "/Applications/XGEN Side.app/agent-browser"
        };
        let start = core.dispatch(request(
            "two",
            "browser.start",
            Some(TOKEN),
            json!({
                "runId": "run-1",
                "enginePath": engine_path,
                "toolProfiles": ["core"],
                "environment": { "OPENAI_API_KEY": "must-not-cross" }
            }),
        ));
        assert!(!start.response.ok);
        assert!(start.action.is_none());
    }

    #[test]
    fn authorizes_only_named_bounded_local_storage_values() {
        let mut core = XgenCore::default();
        core.dispatch(request(
            "one",
            "handshake",
            None,
            json!({ "sessionToken": TOKEN }),
        ));
        let write = core.dispatch(request(
            "two",
            "storage.write",
            Some(TOKEN),
            json!({ "key": "credentials", "content": "encrypted-only" }),
        ));
        assert!(matches!(
            write.action,
            Some(CoreAction::WriteStorage {
                key: StorageKey::Credentials,
                ..
            })
        ));
        assert!(!serde_json::to_string(&write.response)
            .unwrap()
            .contains("encrypted-only"));

        let invalid = core.dispatch(request(
            "three",
            "storage.read",
            Some(TOKEN),
            json!({ "key": "../../private" }),
        ));
        assert_eq!(invalid.response.error.unwrap().code, "invalid_storage_read");
    }
}
