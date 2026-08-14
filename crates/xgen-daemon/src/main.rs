use std::io::{self, BufReader};

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--version") {
        println!("xgen-daemon {}", env!("CARGO_PKG_VERSION"));
        return;
    }

    let stdin = io::stdin();
    let stdout = io::stdout();
    if let Err(error) = xgen_daemon::run(BufReader::new(stdin.lock()), stdout.lock()) {
        eprintln!("xgen-daemon: {error}");
        std::process::exit(1);
    }
}
