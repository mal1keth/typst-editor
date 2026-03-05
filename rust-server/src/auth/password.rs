use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};

pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2.hash_password(password.as_bytes(), &salt)?;
    Ok(hash.to_string())
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    // Try argon2 first
    if let Ok(parsed) = PasswordHash::new(hash) {
        if Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok()
        {
            return true;
        }
    }

    // Fall back to bcrypt for legacy hashes from the TypeScript server
    bcrypt::verify(password, hash).unwrap_or(false)
}

pub fn validate_password_strength(password: &str) -> Option<String> {
    if password.len() < 8 {
        return Some("Password must be at least 8 characters".to_string());
    }
    if password.len() > 128 {
        return Some("Password must be at most 128 characters".to_string());
    }
    None
}
