// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `ClashWin.exe --cli <command>` behaves like clashwin-cli (used by the PATH shims).
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(|a| a == "--cli").unwrap_or(false) {
        clashwin_lib::cli::attach_parent_console();
        std::process::exit(clashwin_lib::cli::main_with_args(args[2..].to_vec()));
    }
    clashwin_lib::run()
}
