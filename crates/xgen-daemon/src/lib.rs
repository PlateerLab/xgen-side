use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use xgen_core::{
    error_response, BrowserStartSpec, CoreAction, CoreRequest, CoreResponse, StorageKey, XgenCore,
    MAX_MESSAGE_BYTES,
};

const RELAY_PROTOCOL: &str = "xgen.mcp-relay.v1";

pub fn run<R: BufRead, W: Write>(reader: R, mut writer: W) -> Result<(), String> {
    let mut core = XgenCore::default();
    let mut browser_relays = BrowserRelayManager::default();
    let storage = StorageManager::from_environment();
    for line in reader.lines() {
        let line = line.map_err(|_| "Could not read the XGEN Core channel.".to_string())?;
        if line.len() > MAX_MESSAGE_BYTES {
            write_response(
                &mut writer,
                &error_response(
                    "invalid",
                    "message_too_large",
                    "XGEN Core message is too large.",
                ),
            )?;
            continue;
        }
        let request = match serde_json::from_str::<CoreRequest>(&line) {
            Ok(request) => request,
            Err(_) => {
                write_response(
                    &mut writer,
                    &error_response("invalid", "invalid_json", "Invalid XGEN Core request."),
                )?;
                continue;
            }
        };
        let result = core.dispatch(request);
        let response = match result.action {
            Some(CoreAction::StartBrowser(spec)) => browser_relays
                .start(spec)
                .map(|relay| success_response(result.response.id.clone(), relay))
                .unwrap_or_else(|_| {
                    error_response(
                        result.response.id,
                        "browser_start_failed",
                        "Could not start the trusted browser relay.",
                    )
                }),
            Some(CoreAction::StopBrowser { run_id }) => {
                browser_relays.stop(&run_id);
                success_response(
                    result.response.id,
                    serde_json::json!({ "state": "stopped" }),
                )
            }
            Some(CoreAction::ReadStorage { key }) => storage
                .as_ref()
                .ok_or(())
                .and_then(|storage| storage.read(key).map_err(|_| ()))
                .map(|content| {
                    success_response(
                        result.response.id.clone(),
                        serde_json::json!({ "state": "ready", "content": content }),
                    )
                })
                .unwrap_or_else(|_| {
                    error_response(
                        result.response.id,
                        "storage_read_failed",
                        "Could not read trusted local storage.",
                    )
                }),
            Some(CoreAction::WriteStorage { key, content }) => storage
                .as_ref()
                .ok_or(())
                .and_then(|storage| storage.write(key, &content).map_err(|_| ()))
                .map(|_| {
                    success_response(
                        result.response.id.clone(),
                        serde_json::json!({ "state": "stored" }),
                    )
                })
                .unwrap_or_else(|_| {
                    error_response(
                        result.response.id,
                        "storage_write_failed",
                        "Could not write trusted local storage.",
                    )
                }),
            None => result.response,
        };
        write_response(&mut writer, &response)?;
        if result.shutdown {
            browser_relays.stop_all();
            break;
        }
    }
    Ok(())
}

struct StorageManager {
    root: PathBuf,
}

impl StorageManager {
    fn from_environment() -> Option<Self> {
        let root = std::env::var_os("XGEN_CORE_DATA_ROOT").map(PathBuf::from)?;
        if !root.is_absolute() || root.as_os_str().len() > 4_096 {
            return None;
        }
        Some(Self { root })
    }

    fn read(&self, key: StorageKey) -> io::Result<Option<String>> {
        let path = self.path(key);
        match fs::read_to_string(path) {
            Ok(content) if content.len() <= xgen_core::MAX_BLOB_CHARACTERS => Ok(Some(content)),
            Ok(_) => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Stored value is too large.",
            )),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn write(&self, key: StorageKey, content: &str) -> io::Result<()> {
        if content.len() > xgen_core::MAX_BLOB_CHARACTERS {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Stored value is too large.",
            ));
        }
        create_private_directory(&self.root)?;
        let path = self.path(key);
        let temporary = self.root.join(format!("{}.tmp", key.file_name()));
        let backup = self.root.join(format!("{}.backup", key.file_name()));
        let mut options = OpenOptions::new();
        options.create(true).truncate(true).write(true);
        configure_private_file(&mut options);
        let mut file = options.open(&temporary)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        drop(file);

        if path.exists() {
            let _ = fs::remove_file(&backup);
            fs::rename(&path, &backup)?;
        }
        if let Err(error) = fs::rename(&temporary, &path) {
            if backup.exists() {
                let _ = fs::rename(&backup, &path);
            }
            return Err(error);
        }
        let _ = fs::remove_file(backup);
        Ok(())
    }

    fn path(&self, key: StorageKey) -> PathBuf {
        self.root.join(key.file_name())
    }
}

fn create_private_directory(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

#[cfg(unix)]
fn configure_private_file(options: &mut OpenOptions) {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
}

#[cfg(not(unix))]
fn configure_private_file(_options: &mut OpenOptions) {}

fn success_response(id: String, result: serde_json::Value) -> CoreResponse {
    CoreResponse {
        protocol: xgen_core::PROTOCOL,
        id,
        ok: true,
        result: Some(result),
        error: None,
    }
}

#[derive(Default)]
struct BrowserRelayManager {
    sessions: HashMap<String, BrowserRelay>,
}

impl BrowserRelayManager {
    fn start(&mut self, spec: BrowserStartSpec) -> Result<serde_json::Value, String> {
        if self.sessions.contains_key(&spec.run_id) {
            return Err("Browser relay already exists.".to_string());
        }
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|_| "Could not bind browser relay.".to_string())?;
        listener
            .set_nonblocking(true)
            .map_err(|_| "Could not configure browser relay.".to_string())?;
        let address = listener
            .local_addr()
            .map_err(|_| "Could not read browser relay address.".to_string())?;
        let token = random_token()?;
        let tools = spec.tool_profiles.join(",");
        let mut command = Command::new(&spec.engine_path);
        command
            .args(["mcp", "--tools", &tools])
            .env_clear()
            .envs(&spec.environment)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|_| "Could not launch browser engine.".to_string())?;
        let child_stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Browser engine stdin is unavailable.".to_string())?;
        let child_stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Browser engine stdout is unavailable.".to_string())?;
        let child_stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Browser engine stderr is unavailable.".to_string())?;
        let child = Arc::new(Mutex::new(child));
        let stopped = Arc::new(AtomicBool::new(false));
        spawn_relay(
            listener,
            token.clone(),
            Arc::clone(&stopped),
            Arc::clone(&child),
            child_stdin,
            child_stdout,
            child_stderr,
        );
        self.sessions
            .insert(spec.run_id, BrowserRelay { child, stopped });
        Ok(serde_json::json!({
            "state": "ready",
            "address": address.to_string(),
            "token": token,
            "protocol": RELAY_PROTOCOL,
        }))
    }

    fn stop(&mut self, run_id: &str) {
        if let Some(relay) = self.sessions.remove(run_id) {
            relay.stop();
        }
    }

    fn stop_all(&mut self) {
        for (_, relay) in self.sessions.drain() {
            relay.stop();
        }
    }
}

impl Drop for BrowserRelayManager {
    fn drop(&mut self) {
        self.stop_all();
    }
}

struct BrowserRelay {
    child: Arc<Mutex<Child>>,
    stopped: Arc<AtomicBool>,
}

impl BrowserRelay {
    fn stop(self) {
        self.stopped.store(true, Ordering::Release);
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn spawn_relay(
    listener: TcpListener,
    token: String,
    stopped: Arc<AtomicBool>,
    child: Arc<Mutex<Child>>,
    mut child_stdin: impl Write + Send + 'static,
    mut child_stdout: impl Read + Send + 'static,
    mut child_stderr: impl Read + Send + 'static,
) {
    thread::spawn(move || {
        thread::spawn(move || {
            let _ = io::copy(&mut child_stderr, &mut io::sink());
        });
        while !stopped.load(Ordering::Acquire) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    if stream.set_nonblocking(false).is_err() {
                        let _ = stream.shutdown(std::net::Shutdown::Both);
                        continue;
                    }
                    if !authenticate_relay(&mut stream, &token) {
                        let _ = stream.shutdown(std::net::Shutdown::Both);
                        continue;
                    }
                    let Ok(mut inbound) = stream.try_clone() else {
                        break;
                    };
                    let input = thread::spawn(move || io::copy(&mut inbound, &mut child_stdin));
                    let _ = io::copy(&mut child_stdout, &mut stream);
                    let _ = input.join();
                    stopped.store(true, Ordering::Release);
                    break;
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(20));
                }
                Err(_) => break,
            }
        }
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    });
}

fn authenticate_relay(stream: &mut TcpStream, expected_token: &str) -> bool {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let Ok(reader_stream) = stream.try_clone() else {
        return false;
    };
    let mut reader = BufReader::new(reader_stream);
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() || line.len() > 4_096 {
        return false;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
        return false;
    };
    let protocol = value.get("protocol").and_then(serde_json::Value::as_str);
    let token = value.get("token").and_then(serde_json::Value::as_str);
    if protocol != Some(RELAY_PROTOCOL)
        || !token
            .is_some_and(|value| constant_time_equal(value.as_bytes(), expected_token.as_bytes()))
    {
        return false;
    }
    let _ = stream.set_read_timeout(None);
    stream.write_all(b"{\"ok\":true}\n").is_ok() && stream.flush().is_ok()
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::getrandom(&mut bytes)
        .map_err(|_| "Secure randomness is unavailable.".to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
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

fn write_response<W: Write>(
    writer: &mut W,
    response: &xgen_core::CoreResponse,
) -> Result<(), String> {
    serde_json::to_writer(&mut *writer, response)
        .map_err(|_| "Could not encode the XGEN Core response.".to_string())?;
    writer
        .write_all(b"\n")
        .and_then(|_| writer.flush())
        .map_err(|_| "Could not write the XGEN Core response.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::io::{BufReader, Cursor};

    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn private_stdio_session_handles_health_and_shutdown() {
        let input = format!(
            "{{\"protocol\":\"xgen.core.v1\",\"id\":\"one\",\"method\":\"handshake\",\"params\":{{\"sessionToken\":\"{TOKEN}\"}}}}\n{{\"protocol\":\"xgen.core.v1\",\"id\":\"two\",\"method\":\"health\",\"sessionToken\":\"{TOKEN}\"}}\n{{\"protocol\":\"xgen.core.v1\",\"id\":\"three\",\"method\":\"shutdown\",\"sessionToken\":\"{TOKEN}\"}}\n"
        );
        let mut output = Vec::new();
        run(BufReader::new(Cursor::new(input)), &mut output).unwrap();
        let output = String::from_utf8(output).unwrap();
        let responses = output
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(responses.len(), 3);
        assert_eq!(responses[0]["result"]["state"], "ready");
        assert_eq!(responses[1]["result"]["service"], "xgen-core");
        assert_eq!(responses[2]["result"]["state"], "stopping");
        assert!(!output.contains(TOKEN));
    }

    #[test]
    fn malformed_input_returns_bounded_error_without_stopping() {
        let mut output = Vec::new();
        run(BufReader::new(Cursor::new("not-json\n")), &mut output).unwrap();
        let response: Value = serde_json::from_slice(&output).unwrap();
        assert_eq!(response["error"]["code"], "invalid_json");
    }

    #[test]
    fn trusted_storage_uses_fixed_private_file_names() {
        let root = std::env::temp_dir().join(format!(
            "xgen-core-storage-test-{}",
            random_token().unwrap()
        ));
        let storage = StorageManager { root: root.clone() };
        storage
            .write(StorageKey::Credentials, "ciphertext")
            .unwrap();
        assert_eq!(
            storage.read(StorageKey::Credentials).unwrap(),
            Some("ciphertext".to_string())
        );
        assert!(root.join("credentials.vault").exists());
        assert!(!root.join("credentials.vault.tmp").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
