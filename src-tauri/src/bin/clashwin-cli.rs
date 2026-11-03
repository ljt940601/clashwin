//! `clashwin-cli`: terminal control for ClashWin's mihomo core. See `clashwin_lib::cli`.

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    std::process::exit(clashwin_lib::cli::main_with_args(args));
}
