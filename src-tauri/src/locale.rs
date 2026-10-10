use std::sync::OnceLock;

/// Supported UI languages, in the order `text` expects its messages.
const LANGS: [&str; 5] = ["en", "zh", "ja", "es", "fr"];

/// Picks the first supported language from the OS preference list, else English.
fn detect(locales: impl IntoIterator<Item = String>) -> usize {
    locales
        .into_iter()
        .find_map(|tag| {
            let base = tag.split(['-', '_']).next()?.to_lowercase();
            LANGS.iter().position(|lang| *lang == base)
        })
        .unwrap_or(0)
}

/// A saved language from settings wins; "system" or anything unknown follows the OS.
fn choose(saved: Option<&str>, locales: impl IntoIterator<Item = String>) -> usize {
    saved
        .and_then(|saved| LANGS.iter().position(|lang| *lang == saved))
        .unwrap_or_else(|| detect(locales))
}

static INDEX: OnceLock<usize> = OnceLock::new();

/// Fixes the UI language for this run from the saved setting; call before building menus.
pub fn init(saved: Option<&str>) {
    let _ = INDEX.set(choose(saved, sys_locale::get_locales()));
}

fn index() -> usize {
    // Unit tests assert the Chinese messages regardless of the machine's language.
    if cfg!(test) {
        return 1;
    }
    *INDEX.get_or_init(|| detect(sys_locale::get_locales()))
}

/// Returns the message for the OS language from `[en, zh, ja, es, fr]`.
pub fn text(messages: [&'static str; 5]) -> &'static str {
    messages[index()]
}

/// Lets every window render in the same language as the native menus and errors.
#[tauri::command]
pub fn ui_language() -> &'static str {
    LANGS[index()]
}

#[cfg(test)]
mod tests {
    use super::{choose, detect};

    #[test]
    fn picks_first_supported_language_or_english() {
        let tags = |list: &[&str]| list.iter().map(|tag| tag.to_string()).collect::<Vec<_>>();
        assert_eq!(detect(tags(&["zh-Hans-CN", "en-US"])), 1);
        assert_eq!(detect(tags(&["de-DE", "ja_JP"])), 2);
        assert_eq!(detect(tags(&["fr"])), 4);
        assert_eq!(detect(tags(&["de-DE", "ko-KR"])), 0);
        assert_eq!(detect(tags(&[])), 0);
        assert_eq!(choose(Some("ja"), tags(&["zh-CN"])), 2);
        assert_eq!(choose(Some("system"), tags(&["zh-CN"])), 1);
        assert_eq!(choose(None, tags(&["de-DE"])), 0);
    }
}
