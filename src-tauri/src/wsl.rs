use std::sync::OnceLock;

fn detect(
    platform: bool,
    env: impl Fn(&str) -> Option<String>,
    read_version: impl Fn() -> std::io::Result<String>,
) -> bool {
    if !platform {
        return false;
    }
    if env("WSL_DISTRO_NAME").map(|v| !v.is_empty()).unwrap_or(false)
        || env("WSL_INTEROP").map(|v| !v.is_empty()).unwrap_or(false)
    {
        return true;
    }
    match read_version() {
        Ok(s) => {
            let s = s.to_lowercase();
            s.contains("microsoft") || s.contains("wsl")
        }
        Err(_) => false,
    }
}

fn detect_prod() -> bool {
    detect(
        cfg!(target_os = "linux"),
        |k| std::env::var_os(k).map(|v| v.to_string_lossy().into_owned()),
        || std::fs::read_to_string("/proc/version"),
    )
}

static CACHED: OnceLock<bool> = OnceLock::new();

pub fn cached_is_wsl() -> bool {
    *CACHED.get_or_init(detect_prod)
}

#[tauri::command]
pub fn is_wsl() -> bool {
    cached_is_wsl()
}

#[cfg(test)]
mod tests {
    use super::detect;
    use std::io;

    fn env_of<'p>(
        pairs: &'p [(&'p str, &'p str)],
    ) -> impl for<'a> Fn(&'a str) -> Option<String> + 'p {
        move |k: &str| {
            pairs
                .iter()
                .find(|(name, _)| *name == k)
                .map(|(_, v)| v.to_string())
        }
    }

    fn no_env(_: &str) -> Option<String> {
        None
    }

    fn version(s: &str) -> impl Fn() -> std::io::Result<String> + '_ {
        move || Ok(s.to_string())
    }

    fn unreadable() -> impl Fn() -> std::io::Result<String> {
        || Err(io::Error::new(io::ErrorKind::PermissionDenied, "denied"))
    }

    #[test]
    fn non_linux_is_false_even_when_env_markers_present() {
        let env = env_of(&[("WSL_DISTRO_NAME", "Ubuntu"), ("WSL_INTEROP", "/run/WSL")]);
        assert!(!detect(false, env, version("Linux version 6.6 microsoft")));
    }

    #[test]
    fn wsl_distro_name_env_is_true_without_proc_probe() {
        let env = env_of(&[("WSL_DISTRO_NAME", "Ubuntu")]);
        assert!(detect(true, env, unreadable()));
    }

    #[test]
    fn wsl_interop_env_is_true_without_proc_probe() {
        let env = env_of(&[("WSL_INTEROP", "/run/WSL")]);
        assert!(detect(true, env, unreadable()));
    }

    #[test]
    fn empty_env_vars_fall_through_to_proc() {
        let env = env_of(&[("WSL_DISTRO_NAME", ""), ("WSL_INTEROP", "")]);
        assert!(!detect(true, &env, version("Linux version 6.6.87")));
        assert!(detect(true, &env, version("Linux version 5.15.167.4-microsoft-standard-WSL2")));
    }

    #[test]
    fn proc_version_microsoft_is_case_insensitive() {
        assert!(detect(true, no_env, version("Linux version 5.15.167.4-Microsoft-standard-WSL2")));
        assert!(detect(true, no_env, version("Linux version 6.6 MICROSOFT")));
    }

    #[test]
    fn proc_version_wsl_is_case_insensitive() {
        assert!(detect(true, no_env, version("Linux version 5.15.167.4-WSL2")));
        assert!(detect(true, no_env, version("Linux version 6.6 custom-wsl")));
    }

    #[test]
    fn ordinary_linux_proc_version_is_false() {
        assert!(!detect(true, no_env, version("Linux version 6.8.0-45-generic")));
        assert!(!detect(true, no_env, version("Linux version 6.1.0-debian")));
    }

    #[test]
    fn unreadable_proc_version_is_false() {
        assert!(!detect(true, no_env, unreadable()));
    }

    #[test]
    fn env_markers_short_circuit_before_proc_read() {
        let env = env_of(&[("WSL_DISTRO_NAME", "Ubuntu")]);
        let reads = std::cell::Cell::new(0);
        let read = || {
            reads.set(reads.get() + 1);
            Err(io::Error::other("must not be read"))
        };
        assert!(detect(true, env, read));
        assert_eq!(reads.get(), 0);
    }
}
