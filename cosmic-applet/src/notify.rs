use notify_rust::Notification;

const APP_NAME: &str = "Amelia";

pub fn show(summary: impl AsRef<str>, body: impl AsRef<str>) {
    let _ = Notification::new()
        .summary(summary.as_ref())
        .body(body.as_ref())
        .appname(APP_NAME)
        .timeout(notify_rust::Timeout::Milliseconds(8_000))
        .show();
}

pub fn truncate_body(text: &str, max_chars: usize) -> String {
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max_chars {
        return flat;
    }
    let trimmed: String = flat.chars().take(max_chars).collect();
    format!("{trimmed}…")
}
