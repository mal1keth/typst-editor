pub mod middleware;
pub mod password;

use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JwtPayload {
    pub user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub github_login: Option<String>,
    pub exp: usize,
    pub iat: usize,
}

// JWT claims using camelCase for compatibility with the TS server's jose library
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JwtClaims {
    user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    github_login: Option<String>,
    exp: usize,
    iat: usize,
}

pub fn sign_token(secret: &str, user_id: &str, github_login: Option<&str>) -> Result<String, jsonwebtoken::errors::Error> {
    let now = Utc::now();
    let exp = (now + Duration::days(7)).timestamp() as usize;
    let iat = now.timestamp() as usize;

    let claims = JwtClaims {
        user_id: user_id.to_string(),
        github_login: github_login.map(|s| s.to_string()),
        exp,
        iat,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

pub fn verify_token(secret: &str, token: &str) -> Option<JwtPayload> {
    let mut validation = Validation::default();
    validation.required_spec_claims.clear();

    let token_data = decode::<JwtClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .ok()?;

    Some(JwtPayload {
        user_id: token_data.claims.user_id,
        github_login: token_data.claims.github_login,
        exp: token_data.claims.exp,
        iat: token_data.claims.iat,
    })
}
